import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'AI Chat to PDF' });
});

// ZIP download of the unpacked extension directory
app.get('/api/download-extension-zip', async (req, res) => {
  try {
    const zip = new JSZip();
    const extensionDir = path.join(__dirname, 'extension');

    function addDirToZip(dirPath, zipFolder) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const subFolder = zipFolder.folder(entry.name);
          addDirToZip(fullPath, subFolder);
        } else if (entry.isFile()) {
          const fileContent = fs.readFileSync(fullPath);
          zipFolder.file(entry.name, fileContent);
        }
      }
    }

    addDirToZip(extensionDir, zip);

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="AI-Chat-to-PDF-extension.zip"');
    res.send(zipBuffer);
  } catch (err) {
    console.error('Error generating zip:', err);
    res.status(500).json({ error: 'Failed to generate extension zip', details: err.message });
  }
});

// Serve extension directory statically for direct access
app.use(express.static(path.join(__dirname, 'extension')));

// Route root to export.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'extension', 'export', 'export.html'));
});

app.get('/popup', (req, res) => {
  res.sendFile(path.join(__dirname, 'extension', 'popup', 'popup.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`AI Chat to PDF server running on http://${HOST}:${PORT}`);
});
