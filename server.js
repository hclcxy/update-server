const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const VERSIONS_FILE = path.join(__dirname, 'versions.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function getConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    return { downloadPath: path.join(__dirname, 'downloads') };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function getVersions() {
    if (fs.existsSync(VERSIONS_FILE)) {
        return JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
    }
    return { versions: [] };
}

function saveVersions(data) {
    fs.writeFileSync(VERSIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

const config = getConfig();
ensureDir(config.downloadPath);

// 获取下载路径
app.get('/api/config', (req, res) => {
    res.json(getConfig());
});

// 设置下载路径
app.post('/api/config', (req, res) => {
    const { downloadPath } = req.body;
    if (!downloadPath) {
        return res.status(400).json({ error: 'downloadPath is required' });
    }
    const absolutePath = path.resolve(downloadPath);
    ensureDir(absolutePath);
    const newConfig = { downloadPath: absolutePath };
    saveConfig(newConfig);
    res.json(newConfig);
});

// 获取版本历史
app.get('/api/versions', (req, res) => {
    res.json(getVersions());
});

// 添加新版本
app.post('/api/versions', (req, res) => {
    const { version, note, filename, platform } = req.body;
    if (!version || !filename) {
        return res.status(400).json({ error: 'version and filename are required' });
    }
    const data = getVersions();
    const newVersion = {
        id: Date.now(),
        version,
        note: note || '',
        filename,
        platform: platform || 'all',
        createdAt: new Date().toISOString()
    };
    data.versions.unshift(newVersion);
    saveVersions(data);
    res.json(newVersion);
});

// 删除版本
app.delete('/api/versions/:id', (req, res) => {
    const data = getVersions();
    data.versions = data.versions.filter(v => v.id != req.params.id);
    saveVersions(data);
    res.json({ success: true });
});

// 获取可下载文件列表
app.get('/api/files', (req, res) => {
    const cfg = getConfig();
    const downloadPath = cfg.downloadPath;
    if (!fs.existsSync(downloadPath)) {
        return res.json({ files: [] });
    }
    const files = fs.readdirSync(downloadPath)
        .filter(f => fs.statSync(path.join(downloadPath, f)).isFile())
        .map(f => {
            const stat = fs.statSync(path.join(downloadPath, f));
            return {
                name: f,
                size: stat.size,
                modified: stat.mtime
            };
        });
    res.json({ files });
});

// 下载文件（支持指定存储路径）
app.get('/api/download/:filename', (req, res) => {
    const cfg = getConfig();
    const filePath = path.join(cfg.downloadPath, req.params.filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    res.download(filePath);
});

// 下载文件到本地指定路径（仅适用于本机调用，返回文件流供客户端保存）
app.post('/api/download/:filename', async (req, res) => {
    const cfg = getConfig();
    const sourcePath = path.join(cfg.downloadPath, req.params.filename);
    
    if (!fs.existsSync(sourcePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    const { localPath, rename } = req.body;
    
    if (!localPath) {
        return res.status(400).json({ error: 'localPath is required in request body' });
    }

    try {
        const targetDir = path.resolve(localPath);
        
        ensureDir(targetDir);
        
        const targetFileName = rename || req.params.filename;
        const targetPath = path.join(targetDir, targetFileName);
        
        // 复制文件到本地目标路径
        await fs.promises.copyFile(sourcePath, targetPath);
        
        res.json({
            success: true,
            message: 'File saved to local path successfully',
            source: sourcePath,
            target: targetPath,
            filename: targetFileName,
            size: fs.statSync(targetPath).size
        });
    } catch (error) {
        res.status(500).json({
            error: 'Save failed',
            message: error.message
        });
    }
});

// 获取文件流（供客户端下载到本地）
app.get('/api/file/:filename', (req, res) => {
    const cfg = getConfig();
    const filePath = path.join(cfg.downloadPath, req.params.filename);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
});

// 获取最新版本信息（兼容 update.json 格式）
app.get('/api/update', (req, res) => {
    const data = getVersions();
    const latest = data.versions[0];
    if (!latest) {
        return res.status(404).json({ error: 'No versions available' });
    }
    res.json({
        appid: 'localApp',
        version: latest.version,
        note: latest.note,
        url: `/api/download/${latest.filename}`
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Download path: ${config.downloadPath}`);
});
