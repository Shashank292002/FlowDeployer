app.post("/deploy-flow", async (req, res) => {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) return res.status(401).json({ error: "Unauthorized" });

  let { flowXml, flowName } = req.body;
  if (!flowXml || !flowName) return res.status(400).json({ error: "flowXml and flowName are required" });

  const timestamp = Date.now();
  flowName = `${flowName}_${timestamp}`; // prevent caching issues

  const tempDir = path.join(process.cwd(), "temp");
  const flowDir = path.join(tempDir, "flows");
  try {
    // Ensure temp directories exist
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir);

    // Write flow XML
    const flowPath = path.join(flowDir, `${flowName}.flow-meta.xml`);
    fs.writeFileSync(flowPath, flowXml, "utf8");

    // Write package.xml
    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
  <types>
    <members>${flowName}</members>
    <name>Flow</name>
  </types>
  <version>65.0</version>
</Package>`;
    const packagePath = path.join(tempDir, "package.xml");
    fs.writeFileSync(packagePath, packageXml, "utf8");

    // Create zip
    const zip = new AdmZip();
    zip.addLocalFile(packagePath);
    zip.addLocalFolder(flowDir, "flows");
    const zipPath = path.join(tempDir, `${flowName}.zip`);
    zip.writeZip(zipPath);

    // Salesforce deploy
    const conn = new jsforce.Connection({ loginUrl: SF_LOGIN_URL });
    await conn.login(SF_USERNAME, SF_PASSWORD + SF_TOKEN);
    const zipContent = fs.readFileSync(zipPath);
    const deployJob = await conn.metadata.deploy(zipContent, { singlePackage: true });
    const deployId = deployJob.id;

    console.log(`🚀 Deployment started. ID: ${deployId}`);

    let deployRes;
    while (true) {
      deployRes = await conn.metadata.checkDeployStatus(deployId, true);
      console.log(`⏳ Status: ${deployRes.status}`);
      if (deployRes.done === true || deployRes.done === 'true') break;
      await new Promise(r => setTimeout(r, 5000));
    }

    console.log("✅ Deploy Result:", deployRes);
    res.json({ status: "success", flowName, details: deployRes });

  } catch (err) {
    console.error("❌ Deployment Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    // CLEANUP: remove temp files to prevent stale deployments
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
