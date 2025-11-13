import express from "express";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import jsforce from "jsforce";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const SF_USERNAME = process.env.SF_USERNAME;
const SF_PASSWORD = process.env.SF_PASSWORD;
const SF_TOKEN = process.env.SF_TOKEN;
const SF_LOGIN_URL = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
const API_KEY = process.env.API_KEY;

// Simple API key check
app.use((req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.post("/deploy-flow", async (req, res) => {
  const { flowXml, flowName } = req.body;
  if (!flowXml || !flowName) {
    return res.status(400).json({ error: "flowXml and flowName are required" });
  }

  try {
    const tempDir = path.join(process.cwd(), "temp");
    const flowDir = path.join(tempDir, "flows");

    // Clean old temp folders
    if (fs.existsSync(flowDir)) fs.rmSync(flowDir, { recursive: true, force: true });
    if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir, { recursive: true });

    // Increment flow version automatically
    const updatedFlowXml = flowXml.replace(
      /<versionNumber>(\d+)<\/versionNumber>/,
      (_, v) => `<versionNumber>${Number(v) + 1}</versionNumber>`
    );

    // Write flow XML
    const flowPath = path.join(flowDir, `${flowName}.flow-meta.xml`);
    fs.writeFileSync(flowPath, updatedFlowXml, "utf8");

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

    // Create ZIP
    const zip = new AdmZip();
    zip.addLocalFile(packagePath);
    zip.addLocalFolder(flowDir, "flows");
    const zipPath = path.join(tempDir, `${flowName}.zip`);
    zip.writeZip(zipPath);

    // Salesforce connection
    const conn = new jsforce.Connection({ loginUrl: SF_LOGIN_URL });
    await conn.login(SF_USERNAME, SF_PASSWORD + SF_TOKEN);

    // Deploy
    const zipContent = fs.readFileSync(zipPath);
    const deployJob = await conn.metadata.deploy(zipContent, { singlePackage: true });
    const deployId = deployJob.id;

    console.log(`🚀 Deployment started. ID: ${deployId}`);

    // Poll for completion
    let deployRes;
    while (true) {
      deployRes = await conn.metadata.checkDeployStatus(deployId, true);
      console.log(`⏳ Status: ${deployRes.status}`);
      if (deployRes.done === 'true' || deployRes.done === true) break;
      await new Promise(r => setTimeout(r, 5000));
    }

    console.log("✅ Deploy Result:", deployRes);
    res.json({ status: "success", details: deployRes });

  } catch (err) {
    console.error("❌ Deployment Error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("🚀 Flow deploy API running on port 3000"));
