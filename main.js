// main.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');

let db;
let apiSettings = {};

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 2200,
        height: 1800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    const dbPath = path.join(app.getPath('userData'), 'database.sqlite');
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('Database connection error:', err.message);
        } else {
            console.log('Connected to SQLite database.');
            setupDatabaseAndLoadSettings();
        }
    });
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

function setupDatabaseAndLoadSettings() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT,
            email TEXT,
            role TEXT,
            area TEXT,
            status TEXT,
            photo TEXT,
            order_detail_id INTEGER,
            order_id TEXT,
            start_date TEXT,
            expired_date_in TEXT,
            expired_date_out TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            description TEXT,
            accessLevel TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            ip TEXT,
            area TEXT,
            status TEXT,
            lastSeen TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`, () => {
            loadSettings();
        });
    });
}

function loadSettings() {
    db.all("SELECT key, value FROM settings", [], (err, rows) => {
        if (err) {
            console.error('Error loading settings:', err.message);
            return;
        }
        rows.forEach(row => {
            apiSettings[row.key] = row.value;
        });

        if (!apiSettings.DEVICE_PASS) {
            apiSettings.DEVICE_PASS = '888888';
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['DEVICE_PASS', apiSettings.DEVICE_PASS]);
        }
        if (!apiSettings.BACKOFFICE_API_URL) {
            apiSettings.BACKOFFICE_API_URL = "https://dev-backoffice-api.qbot.jp/api";
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['BACKOFFICE_API_URL', apiSettings.BACKOFFICE_API_URL]);
        }
        if (!apiSettings.API_EMAIL) {
            apiSettings.API_EMAIL = "cravedev@craveasia.com";
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['API_EMAIL', apiSettings.API_EMAIL]);
        }
        if (!apiSettings.API_PASSWORD) {
            apiSettings.API_PASSWORD = "12345678";
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['API_PASSWORD', apiSettings.API_PASSWORD]);
        }
        if (!apiSettings.STORE_ID) {
            apiSettings.STORE_ID = "1"; // default
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['STORE_ID', apiSettings.STORE_ID]);
        }
        if (!apiSettings.ENTRY_TIME_LIMIT) {
            apiSettings.ENTRY_TIME_LIMIT = "2"; // default 2 hours
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['ENTRY_TIME_LIMIT', apiSettings.ENTRY_TIME_LIMIT]);
        }

        startApiServer();
    });
}


// ----------------------------------------------------
// API Server
// ----------------------------------------------------
function mergeUserData(existingUser, newUser) {
    const mergedUser = { ...existingUser };
    const keysToUpdate = ['name', 'email', 'role', 'area', 'status', 'photo', 'order_detail_id', 'order_id', 'start_date', 'expired_date_in', 'expired_date_out'];
    for (const key of keysToUpdate) {
        if (newUser.hasOwnProperty(key) && newUser[key] !== null && newUser[key] !== undefined) {
            mergedUser[key] = newUser[key];
        }
    }
    return mergedUser;
}

function addUserToDB(user) {
    return new Promise((resolve, reject) => {
        const { id, name, email, role, area, status, photo, order_detail_id, order_id, start_date, expired_date_in, expired_date_out } = user;
        
        db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, existingRow) => {
            if (err) {
                return reject(err);
            }

            if (existingRow) {
                console.log(`User with ID ${id} already exists. Merging and updating record.`);
                const mergedUser = mergeUserData(existingRow, user);
                
                db.run(
                    `UPDATE users SET name = ?, email = ?, role = ?, area = ?, status = ?, photo = ?, order_detail_id = ?, order_id = ?, start_date = ?, expired_date_in = ?, expired_date_out = ? WHERE id = ?`,
                    [mergedUser.name, mergedUser.email, mergedUser.role, mergedUser.area, mergedUser.status, mergedUser.photo, mergedUser.order_detail_id, mergedUser.order_id, mergedUser.start_date, mergedUser.expired_date_in, mergedUser.expired_date_out, id],
                    function (err) {
                        if (err) return reject(err);
                        console.log(`Updated user with ID ${id}. Changes: ${this.changes}`);
                        resolve({ id: user.id, changes: this.changes, operation: 'UPDATE' });
                    }
                );
            } else {
                console.log(`User with ID ${id} is new. Inserting new record.`);
                db.run(
                    `INSERT INTO users (id, name, email, role, area, status, photo, order_detail_id, order_id, start_date, expired_date_in, expired_date_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, name, email, role, area, status, photo, order_detail_id, order_id, start_date, expired_date_in, expired_date_out],
                    function (err) {
                        if (err) return reject(err);
                        console.log(`Inserted new user with ID ${id}. Changes: ${this.changes}`);
                        resolve({ id: user.id, changes: this.changes, operation: 'INSERT' });
                    }
                );
            }
        });
    });
}

async function addUserToAllDevices(user) {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, ip FROM devices", [], async (err, devices) => {
            if (err) return reject({ result: -1, message: "Failed to get devices from DB." });
            if (devices.length === 0) {
                return resolve({ result: 1, message: "No devices found in local database." });
            }

            const results = [];

            for (const device of devices) {
                const url = `http://${device.ip}:9090/addDeviceWhiteList`;

                try {
                    const status = await getDeviceStatus(device.ip);
                    if (status === "online") {
                        // Prepare request payload
                        const payload = {
                            totalnum: 1,
                            pass: apiSettings.DEVICE_PASS,
                            currentnum: 1,
                            data: {
                                usertype: "white",
                                name: user.name,
                                idno: user.id,
                                icno: user.id,
                                peoplestartdate: user.start_date,
                                peopleenddate: user.expired_date_out,
                            }
                        };

                        // Add image if present
                        if (user.base64 && user.base64.trim() !== "") {
                            payload.data.picData1 = user.base64;
                        } else {
                            // Add passAlgo if image is missing
                            payload.data.passAlgo = true;
                        }

                        console.log(payload);

                        const response = await axios.post(url, payload);
                        results.push({
                            device: device.ip,
                            result: response.data.result,
                            message: response.data.message
                        });
                    } else {
                        results.push({
                            device: device.ip,
                            result: -1,
                            message: "Device is offline, skipping."
                        });
                    }
                } catch (error) {
                    results.push({
                        device: device.ip,
                        result: -1,
                        message: `API call failed: ${error.message}`
                    });
                }
            }

            resolve(results);
        });
    });
}


async function getImageBase64(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const contentType = response.headers['content-type'];
        const base64String = Buffer.from(response.data, 'binary').toString('base64');
        return `data:${contentType};base64,${base64String}`;
    } catch (error) {
        console.error(`Failed to download or convert image from URL: ${url}`, error);
        return null;
    }
}

function needsPhotoUpdate(existingPhotoPath, newImageUrl) {
    if (!newImageUrl) return false;
    if (!existingPhotoPath) return true;
    // Could add more sophisticated checking here (e.g., comparing timestamps)
    return true;
}

// Updated performLoginAndSync function for main.js
async function performLoginAndSync() {
    const now = new Date();
    console.log("Starting login and sync process...");

    function generateUniqueId() {
        const timestampPart = Date.now().toString().slice(-6);
        const randomPart = Math.floor(Math.random() * 1_000_000)
            .toString()
            .padStart(6, "0");
        return timestampPart + randomPart;
    }

    function formatDateForDevice(date) {
        const d = new Date(date);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }

    try {
        // 1. Authenticate
        const loginResponse = await axios.post(`${apiSettings.BACKOFFICE_API_URL}/auth/login`, null, {
            params: {
                email: apiSettings.API_EMAIL,
                password: apiSettings.API_PASSWORD,
            },
        });

        const rawToken = loginResponse.data?.data?.token || "";
        const token = rawToken.includes("|") ? rawToken.split("|")[1].trim() : rawToken.trim();
        console.log("Login successful, token obtained.");

        // 2. Fetch turnstile order details
        const syncResponse = await axios.get(
            `${apiSettings.BACKOFFICE_API_URL}/turnstile-order-details?store_id=${encodeURIComponent(apiSettings.STORE_ID)}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );

        const turnstileDataList = syncResponse.data?.data || [];
        if (!turnstileDataList.length) {
            console.log("No turnstile data to sync.");
            return { success: true, message: "No new users to sync." };
        }
        console.log(`Found ${turnstileDataList.length} turnstile records to process.`);

        // 3. Get existing users from database
        const existingUsers = await new Promise((resolve, reject) => {
            db.all("SELECT id FROM users", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.id));
            });
        });

        const existingUserIds = new Set(existingUsers);
        console.log(`Existing user IDs in database: ${existingUserIds.size}`);

        // 4. Track updates needed for API
        const turnstileUpdates = [];

        // 5. Process each turnstile record
        const results = await Promise.all(
            turnstileDataList.map(async (turnstileData) => {
                let entryId = turnstileData.entry_id;
                let needsUpdate = false;

                // Check if entry_id is null or doesn't exist in DB
                if (!entryId) {
                    // Generate new entry_id
                    entryId = generateUniqueId();
                    needsUpdate = true;
                    console.log(`Generated new entry_id: ${entryId} for turnstile_order_detail_id: ${turnstileData.turnstile_order_detail_id}`);
                } else if (existingUserIds.has(entryId)) {
                    // User already exists, check if image needs update
                    console.log(`User with entry_id ${entryId} already exists. Checking for image updates...`);
                    
                    const existingUser = await new Promise((resolve, reject) => {
                        db.get("SELECT * FROM users WHERE id = ?", [entryId], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });

                    // Check if image needs update
                    if (turnstileData.image) {
                        let base64Image = null;
                        let photoPath = null;

                        const imgBase64 = await getImageBase64(turnstileData.image);
                        if (imgBase64) {
                            const cleanBase64 = imgBase64.replace(/^data:image\/\w+;base64,/, "");
                            base64Image = cleanBase64;
                            
                            try {
                                const buffer = Buffer.from(cleanBase64, "base64");
                                const fileName = `${turnstileData.turnstile_order_detail_id}_${Date.now()}.jpg`;
                                const uploadsDir = path.join(app.getPath("userData"), "uploads");
                                fs.mkdirSync(uploadsDir, { recursive: true });
                                const fullPath = path.join(uploadsDir, fileName);
                                fs.writeFileSync(fullPath, buffer);
                                photoPath = path.join("uploads", fileName);

                                // Delete old photo if exists
                                if (existingUser.photo) {
                                    deletePhotoFile(existingUser.photo);
                                }

                                // Update photo in database
                                await new Promise((resolve, reject) => {
                                    db.run(
                                        "UPDATE users SET photo = ? WHERE id = ?",
                                        [photoPath, entryId],
                                        function(err) {
                                            if (err) reject(err);
                                            else resolve({ changes: this.changes });
                                        }
                                    );
                                });

                                // Update user on devices with new photo
                                const userForDevice = {
                                    ...existingUser,
                                    photo: photoPath,
                                    base64: base64Image
                                };
                                await addUserToAllDevices(userForDevice);
                                
                                console.log(`Updated photo for user ${entryId}`);
                            } catch (err) {
                                console.error("Error updating photo:", err.message);
                            }
                        }
                    }

                    return { 
                        entryId, 
                        skipped: true, 
                        message: "User already exists, image checked/updated" 
                    };
                }

                // Prepare turnstile update data if needed
                if (needsUpdate) {
                    turnstileUpdates.push({
                        turnstile_order_detail_id: turnstileData.turnstile_order_detail_id,
                        order_detail_id: turnstileData.order_detail_id,
                        entry_id: entryId
                    });
                }

                // Download and save image
                let base64Image = null;
                let photoPath = null;

                if (turnstileData.image) {
                    const imgBase64 = await getImageBase64(turnstileData.image);
                    if (imgBase64) {
                        const cleanBase64 = imgBase64.replace(/^data:image\/\w+;base64,/, "");
                        base64Image = cleanBase64;
                        try {
                            const buffer = Buffer.from(cleanBase64, "base64");
                            const fileName = `${turnstileData.turnstile_order_detail_id}_${Date.now()}.jpg`;
                            const uploadsDir = path.join(app.getPath("userData"), "uploads");
                            fs.mkdirSync(uploadsDir, { recursive: true });
                            const fullPath = path.join(uploadsDir, fileName);
                            fs.writeFileSync(fullPath, buffer);
                            photoPath = path.join("uploads", fileName);
                        } catch (err) {
                            console.error("Error saving photo:", err.message);
                            base64Image = null;
                        }
                    }
                }

                // Calculate expiry dates
                const entryDate = new Date(turnstileData.entry_at);
                const entryTimeLimitHours = parseInt(apiSettings.ENTRY_TIME_LIMIT) || 2;
                const exitDate = new Date(entryDate.getTime() + (entryTimeLimitHours * 60 * 60 * 1000));

                // Create user object
                const user = {
                    id: entryId,
                    name: `User-${turnstileData.order_detail_id}`,
                    email: null,
                    role: "guest",
                    area: "default",
                    status: "Paid",
                    photo: photoPath,
                    base64: base64Image,
                    order_detail_id: turnstileData.order_detail_id,
                    order_id: turnstileData.order_detail_id.toString(),
                    start_date: formatDateForDevice(turnstileData.entry_at),
                    expired_date_in: formatDateForDevice(turnstileData.entry_at),
                    expired_date_out: formatDateForDevice(exitDate),
                };

                // Add to database
                const dbResult = await addUserToDB(user);
                
                // Add to devices
                const deviceResults = await addUserToAllDevices(user);

                console.log(`Processed user ${user.name}:`, { dbResult, deviceResults });

                return { 
                    entryId, 
                    dbResult, 
                    deviceResults, 
                    success: true,
                    needsUpdate 
                };
            })
        );

        // 6. Update entry_ids back to API if there are any
        if (turnstileUpdates.length > 0) {
            console.log(`Updating ${turnstileUpdates.length} entry_ids back to API...`);
            try {
                const updateResponse = await axios.post(
                    `${apiSettings.BACKOFFICE_API_URL}/turnstile-order-details`,
                    { turnstileData: turnstileUpdates },
                    { 
                        headers: { 
                            Authorization: `Bearer ${token}`, 
                            "Content-Type": "application/json" 
                        } 
                    }
                );
                console.log("API update response:", updateResponse.data);
            } catch (updateErr) {
                console.error("Failed to update entry_ids to API:", updateErr.response?.data || updateErr.message);
            }
        }

        const newUsers = results.filter(r => !r.skipped).length;
        const skippedUsers = results.filter(r => r.skipped).length;

        return { 
            success: true, 
            message: `Sync completed. New users: ${newUsers}, Skipped: ${skippedUsers}`,
            results 
        };

    } catch (err) {
        console.error("Sync error details:", {
            status: err.response?.status,
            headers: err.response?.headers,
            data: err.response?.data,
        });
        throw new Error("Sync failed. Check logs for details.");
    }
}

function startApiServer() {
    const appServer = express();
    const PORT = 3000;

    appServer.use(cors());
    appServer.use(bodyParser.json({ limit: '10mb' }));

    appServer.post('/api/add', async (req, res) => {
        const { icno, user_image } = req.body;
        
        try {
            if (!icno || icno.trim() === "") {
                throw new Error("IC number (icno) is required");
            }
            
            let photoPath = null;
            if (user_image) {
                const cleanBase64 = user_image.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(cleanBase64, "base64");
                
                const fileName = `${icno}_${Date.now()}.jpg`;
                const uploadsDir = path.join(app.getPath("userData"), "uploads");
                fs.mkdirSync(uploadsDir, { recursive: true });
                
                const fullPath = path.join(uploadsDir, fileName);
                fs.writeFileSync(fullPath, buffer);
                
                photoPath = path.join("uploads", fileName);
            }

            const user = {
                id: icno,
                name: req.body.name || icno,
                email: req.body.email || null,
                role: "guest",
                area: "default",
                status: "Paid",
                base64: user_image || null,
                photo: photoPath || null,
                order_detail_id: req.body.order_detail_id || null,
                order_id: req.body.order_id || null,
                start_date: req.body.start_date || null,
                expired_date_in: req.body.expired_date_in || null,
                expired_date_out: req.body.expired_date_out || null
            };
            
            const dbResult = await addUserToDB(user);
            const deviceResults = await addUserToAllDevices(user);

            res.json({
                success: true,
                message: "User added successfully",
                db: dbResult,
                devices: deviceResults
            });
        } catch (err) {
            console.error("❌ Error in /api/add:", err);
            res.status(500).json({ success: false, message: "Failed to add user", error: err.message });
        }
    });

    appServer.post("/api/orders/store", async (req, res) => {
        console.log(req.body);
        const token = req.query.token;
        const orderData = req.body.orderData;
    
        if (!token) {
            return res.status(400).json({ success: false, message: "Token is required" });
        }
    
        if (!orderData) {
            return res.status(400).json({ success: false, message: "orderData is required" });
        }
    
        try {
            const response = await axios.post(
                `${apiSettings.BACKOFFICE_API_URL}/orders/store`,
                { orderData },
                {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json"
                    }
                }
            );
            res.status(response.status).json(response.data);
        } catch (err) {
            console.error("❌ Error in /api/orders/store:", err.response?.data || err.message);
            res.status(err.response?.status || 500).json({
                success: false,
                message: "Failed to forward order",
                error: err.response?.data || err.message
            });
        }
    });

    appServer.post("/api/face", async (req, res) => {
        const { cleanBase64 } = req.body;
    
        if (!cleanBase64) {
            return res.status(400).json({ success: false, message: "cleanBase64 (base64) is required" });
        }
    
        try {
            const results = await new Promise((resolve, reject) => {
                db.all("SELECT id, ip FROM devices", [], async (err, devices) => {
                    if (err) return reject({ result: -1, message: "Failed to get devices from DB." });
    
                    if (devices.length === 0) {
                        return resolve([{ result: 1, message: "No devices found in local database." }]);
                    }
    
                    const results = [];
                    for (const device of devices) {
                        const url = `http://${device.ip}:9090/getPictureFeature`;
                        try {
                            const status = await getDeviceStatus(device.ip);
                            if (status === "online") {
                                const response = await axios.post(url, {
                                    pass: apiSettings.DEVICE_PASS,
                                    data: {
                                        picData: cleanBase64
                                    }
                                });
                                results.push({
                                    device: device.ip,
                                    result: response.data.result,
                                    message: response.data.message,
                                    raw: response.data
                                });
                            } else {
                                results.push({ device: device.ip, result: -1, message: "Device is offline, skipping." });
                            }
                        } catch (error) {
                            results.push({
                                device: device.ip,
                                result: -1,
                                message: `API call failed: ${error.message}`
                            });
                        }
                    }
    
                    resolve(results);
                });
            });
    
            res.json({ success: true, devices: results });
        } catch (err) {
            console.error("❌ Error in /api/face:", err);
            res.status(500).json({ success: false, message: "Failed to process face request", error: err });
        }
    });

    appServer.post('/api/getdetails', async (req, res) => {
        const { idNo } = req.body;
    
        if (!idNo) {
            return res.status(400).json({ success: false, message: 'idNo is required in the request body.' });
        }
    
        try {
            const devices = await new Promise((resolve, reject) => {
                db.all("SELECT ip FROM devices", [], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
    
            if (devices.length === 0) {
                return res.status(200).json({ success: true, message: "No devices found in local database.", details: [] });
            }
    
            const allDeviceResults = [];
            for (const device of devices) {
                const url = `http://${device.ip}:9090/getDeviceWhiteListDetailByIdNum`;
                try {
                    const status = await getDeviceStatus(device.ip);
                    if (status === 'online') {
                        const response = await axios.post(url, {
                            pass: apiSettings.DEVICE_PASS,
                            data: {
                                idno: idNo,
                            }
                        });
                        allDeviceResults.push({
                            device: device.ip,
                            success: true,
                            response: response.data
                        });
                    } else {
                        allDeviceResults.push({
                            device: device.ip,
                            success: false,
                            message: "Device is offline, skipping."
                        });
                    }
                } catch (error) {
                    allDeviceResults.push({
                        device: device.ip,
                        success: false,
                        message: `API call failed: ${error.message}`
                    });
                }
            }
    
            res.status(200).json({
                success: true,
                message: "User details retrieved from devices.",
                details: allDeviceResults
            });
    
        } catch (err) {
            console.error("❌ Error in /api/getdetails:", err);
            res.status(500).json({ success: false, message: "Failed to retrieve user details.", error: err.message });
        }
    });

    appServer.post('/api/offline', async (req, res) => {
        const createUserLists = req.body.createUserLists || [];
    
        if (!Array.isArray(createUserLists) || createUserLists.length === 0) {
            return res.status(400).json({ success: false, message: "No users to process" });
        }
    
        const results = [];
    
        for (const userData of createUserLists) {
            const { icno, user_image } = userData;
    
            try {
                if (!icno || icno.trim() === "") {
                    results.push({ icno, success: false, message: "IC number (icno) is required" });
                    continue;
                }
    
                let photoPath = null;
                if (user_image && user_image.trim() !== "") {
                    const cleanBase64 = user_image.replace(/^data:image\/\w+;base64,/, "");
                    const buffer = Buffer.from(cleanBase64, "base64");
    
                    const fileName = `${icno}_${Date.now()}.jpg`;
                    const uploadsDir = path.join(app.getPath("userData"), "uploads");
                    fs.mkdirSync(uploadsDir, { recursive: true });
    
                    const fullPath = path.join(uploadsDir, fileName);
                    fs.writeFileSync(fullPath, buffer);
    
                    photoPath = path.join("uploads", fileName);
                }
    
                const user = {
                    id: icno,
                    name: userData.name || icno,
                    email: userData.email || null,
                    role: "guest",
                    area: "default",
                    status: null,
                    base64: user_image || null,
                    photo: photoPath || null,
                    order_detail_id: userData.order_detail_id || null,
                    order_id: userData.order_id || null,
                    start_date: userData.start_date || null,
                    expired_date_in: userData.expired_date_in || null,
                    expired_date_out: userData.expired_date_out || null
                };
    
                // Add user to devices only (no DB save)
                const dbResult = await addUserToDB(user);
                
    
                results.push({
                    icno,
                    success: true,
                    db: dbResult,
                });
    
            } catch (err) {
                results.push({ icno, success: false, message: err.message });
            }
        }
    
        res.json({
            success: true,
            message: "Offline batch processing completed",
            results
        });
    });


    appServer.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ API server running at http://localhost:${PORT}`);
    });
}

// ----------------------------------------------------
// IPC HANDLERS
// ----------------------------------------------------
const TIMEOUT_MS = 1000;

function deletePhotoFile(relativePath) {
    try {
        const fullPath = path.join(app.getPath('userData'), relativePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log(`Successfully deleted file: ${fullPath}`);
            return { success: true };
        }
        return { success: false, message: 'File not found.' };
    } catch (error) {
        console.error('Failed to delete photo:', error);
        return { success: false, message: error.message };
    }
}

async function getDeviceStatus(ip) {
    const url = `http://${ip}:9090/getDeviceParameter`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await axios.post(url, { pass: apiSettings.DEVICE_PASS }, { signal: controller.signal });
        return response.data && response.data.result === 0 ? 'online' : 'offline';
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`Device ${ip} timed out after ${TIMEOUT_MS}ms`);
        } else {
            console.error(`Device ${ip} check failed:`, error.message);
        }
        return 'offline';
    } finally {
        clearTimeout(timeout);
    }
}


ipcMain.handle('addUserToDevices', async (event, userId) => {
    try {
        // Fetch user from DB
        const userFromDB = await getUserFromDB(userId);
        if (!userFromDB) throw new Error('User not found in database');

        // Prepare clean base64 image
        let base64Image = null;
        if (userFromDB.photo) {
            const fullPath = path.join(app.getPath('userData'), userFromDB.photo);
            if (fs.existsSync(fullPath)) {
                base64Image = fs.readFileSync(fullPath).toString('base64');
            }
        }

        // Build user object for device
        let user = {
            id: userFromDB.id,
            name: userFromDB.name || userFromDB.id,
            email: userFromDB.email || null,
            role: userFromDB.role || "guest",
            area: userFromDB.area || "default",
            status: userFromDB.status || "Paid",
            base64: base64Image,
            photo: userFromDB.photo || null,
            order_detail_id: userFromDB.order_detail_id || null,
            order_id: userFromDB.order_id || null,
            start_date: userFromDB.start_date || null,
            expired_date_in: userFromDB.expired_date_in || null,
            expired_date_out: userFromDB.expired_date_out || null
        };

        // First attempt
        let results = await addUserToAllDevices(user);

        // Check for duplicate face
        for (let r of results) {
            if (r.result === 1 && r.message.includes('照片重复')) {
                const regex = /与(\d+),\d+照片重复/;
                const match = r.message.match(regex);
                if (match) {
                    const duplicateIc = match[1];
                    console.log(`Duplicate face detected. Retrying with IC: ${duplicateIc}`);

                    // Rebuild user object for retry with duplicate IC
                    user = {
                        ...user,
                        id: duplicateIc,
                        name: duplicateIc,
                        icno: duplicateIc,
                        idno: duplicateIc
                    };

                    // Retry sync
                    results = await addUserToAllDevices(user);
                    break; // assume only need to retry once
                }
            }
        }

        return results;

    } catch (err) {
        console.error('Error in addUserToDevices:', err);
        throw new Error(err.message);
    }
});

ipcMain.handle('db:updateUser', async (event, user) => {
    try {
        const { id, name, start_date, expired_date_in, expired_date_out } = user;
        
        // Step 1: Update in database
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET name = ?, start_date = ?, expired_date_in = ?, expired_date_out = ? WHERE id = ?`,
                [name, start_date, expired_date_in, expired_date_out, id],
                function(err) {
                    if (err) {
                        console.error('Error updating user in database:', err);
                        reject(err);
                    } else {
                        console.log(`✅ Updated user ${id} in database, rows affected: ${this.changes}`);
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        // Step 2: Get full user data from database (including photo)
        const fullUser = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
                if (err) {
                    console.error('Error fetching user from database:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!fullUser) {
            throw new Error('User not found after update');
        }

        // Step 3: Prepare base64 image if photo exists
        let base64Image = null;
        if (fullUser.photo) {
            const fullPath = path.join(app.getPath('userData'), fullUser.photo);
            if (fs.existsSync(fullPath)) {
                base64Image = fs.readFileSync(fullPath).toString('base64');
                console.log('📸 Photo loaded for device sync');
            }
        }

        // Step 4: Sync to all devices
        const devices = await new Promise((resolve, reject) => {
            db.all("SELECT id, ip FROM devices", [], (err, rows) => {
                if (err) {
                    console.error('Error fetching devices:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });

        if (devices.length === 0) {
            console.log('⚠️ No devices found to sync');
            return { 
                success: true, 
                dbChanges: 1,
                deviceResults: [],
                message: 'User updated in database, but no devices to sync'
            };
        }

        console.log(`🔄 Syncing updated user to ${devices.length} device(s)...`);

        const deviceResults = [];

        for (const device of devices) {
            const url = `http://${device.ip}:9090/addDeviceWhiteList`;

            try {
                // Check device status
                const status = await getDeviceStatus(device.ip);
                
                if (status === "online") {
                    // Prepare request payload
                    const payload = {
                        totalnum: 1,
                        pass: apiSettings.DEVICE_PASS,
                        currentnum: 1,
                        data: {
                            usertype: "white",
                            name: fullUser.name,
                            idno: fullUser.id,
                            icno: fullUser.id,
                            peoplestartdate: fullUser.start_date || "",
                            peopleenddate: fullUser.expired_date_out || "",
                        }
                    };

                    // Add image if present
                    if (base64Image && base64Image.trim() !== "") {
                        payload.data.picData1 = base64Image;
                    } else {
                        // Add passAlgo if image is missing
                        payload.data.passAlgo = true;
                    }

                    console.log(`📤 Sending update to device ${device.ip}:`, {
                        name: payload.data.name,
                        idno: payload.data.idno,
                        hasPhoto: !!payload.data.picData1
                    });

                    const response = await axios.post(url, payload);
                    
                    deviceResults.push({
                        device: device.ip,
                        result: response.data.result,
                        message: response.data.message,
                        success: response.data.result === 0
                    });

                    if (response.data.result === 0) {
                        console.log(`✅ Successfully synced to device ${device.ip}`);
                    } else {
                        console.log(`⚠️ Device ${device.ip} returned non-zero result: ${response.data.message}`);
                    }
                } else {
                    deviceResults.push({
                        device: device.ip,
                        result: -1,
                        message: "Device is offline, skipping.",
                        success: false
                    });
                    console.log(`⚠️ Device ${device.ip} is offline, skipping sync`);
                }
            } catch (error) {
                deviceResults.push({
                    device: device.ip,
                    result: -1,
                    message: `API call failed: ${error.message}`,
                    success: false
                });
                console.error(`❌ Failed to sync to device ${device.ip}:`, error.message);
            }
        }

        // Count successful syncs
        const successfulSyncs = deviceResults.filter(r => r.success).length;
        const totalDevices = devices.length;

        console.log(`✅ Sync complete: ${successfulSyncs}/${totalDevices} devices updated successfully`);

        return {
            success: true,
            dbChanges: 1,
            deviceResults: deviceResults,
            syncSummary: {
                total: totalDevices,
                successful: successfulSyncs,
                failed: totalDevices - successfulSyncs
            },
            message: `User updated in database and synced to ${successfulSyncs}/${totalDevices} devices`
        };

    } catch (error) {
        console.error('❌ Error in db:updateUser:', error);
        return {
            success: false,
            message: error.message,
            error: error
        };
    }
});

// Example: get user from DB
function getUserFromDB(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

ipcMain.handle('updateUserStatus', async (event, userId, status) => {
    return new Promise((resolve, reject) => {
        const sql = "UPDATE users SET status = ? WHERE id = ?";
        db.run(sql, [status, userId], function(err) {
            if (err) return reject(err);
            resolve({ success: true });
        });
    });
});


ipcMain.handle('api:performSync', async () => {
    try {
        const result = await performLoginAndSync();
        return { success: true, result };
    } catch (err) {
        console.error("❌ Error performing sync via IPC:", err);
        return { success: false, message: err.message, error: err.response?.data };
    }
});

ipcMain.handle('api:getDeviceStatus', async (event, ip) => {
    return await getDeviceStatus(ip);
});

ipcMain.handle('api:addUserToAllDevices', async (event, user) => {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, ip FROM devices", [], async (err, devices) => {
            if (err) return reject({ result: -1, message: "Failed to get devices from DB." });

            if (devices.length === 0) {
                return resolve({ result: 1, message: "No devices found in local database." });
            }
            const results = [];
            for (const device of devices) {
                const url = `http://${device.ip}:9090/addDeviceWhiteList`;
                try {
                    const status = await getDeviceStatus(device.ip);
                    if (status === 'online') {
                        const response = await axios.post(url, {
                            totalnum: 1,
                            pass: apiSettings.DEVICE_PASS,
                            currentnum: 1,
                            data: {
                                usertype: "white",
                                name: user.name,
                                idno: user.id,
                                peoplestartdate: user.start_date,
                                peopleenddate: user.expired_date_out,
                                picData1: user.base64
                            }
                        });
                        results.push({ device: device.ip, result: response.data.result, message: response.data.message });
                    } else {
                        results.push({ device: device.ip, result: -1, message: "Device is offline, skipping." });
                    }
                } catch (error) {
                    results.push({ device: device.ip, result: -1, message: `API call failed: ${error.message}` });
                }
            }
            resolve(results);
        });
    });
});

ipcMain.handle('api:deleteUserFromAllDevices', async (event, idno) => {
    return new Promise((resolve, reject) => {
        db.all("SELECT ip FROM devices", [], async (err, devices) => {
            if (err) return reject({ result: -1, message: "Failed to get devices from DB." });

            if (devices.length === 0) {
                return resolve({ result: 1, message: "No devices found in local database." });
            }
            const results = [];
            for (const device of devices) {
                const url = `http://${device.ip}:9090/deleteDeviceWhiteList`;
                try {
                    const response = await axios.post(url, {
                        pass: apiSettings.DEVICE_PASS,
                        data: { 
                            idno: idno, 
                            usertype: "white" 
                        }
                    });
                    results.push({ device: device.ip, result: response.data.result, message: response.data.message });
                } catch (error) {
                    results.push({ device: device.ip, result: -1, message: `API call failed: ${error.message}` });
                }
            }
            resolve(results);
        });
    });
});

ipcMain.handle('api:openGate', async (event, deviceId) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT ip FROM devices WHERE id = ?", [deviceId], async (err, device) => {
            if (err || !device) return reject({ result: -1, message: "Device not found in DB." });

            const url = `http://${device.ip}:9090/setDeviceRemoteOpen`;
            try {
                const response = await axios.post(url, { pass: apiSettings.DEVICE_PASS });
                resolve(response.data);
            } catch (error) {
                reject({ result: -1, message: `Failed to open gate: ${error.message}` });
            }
        });
    });
});

ipcMain.handle('api:restartDevice', async (event, deviceId) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT ip FROM devices WHERE id = ?", [deviceId], async (err, device) => {
            if (err || !device) return reject({ result: -1, message: "Device not found in DB." });

            const url = `http://${device.ip}:9090/setDeviceReboot`;
            try {
                const response = await axios.post(url, {
                    pass: apiSettings.DEVICE_PASS,
                    data: { type: "DelayReboot", value: 5 }
                });
                resolve(response.data);
            } catch (error) {
                reject({ result: -1, message: `Failed to restart device: ${error.message}` });
            }
        });
    });
});

ipcMain.handle('fs:savePhoto', async (event, { id, photoBase64 }) => {
    try {
        const uploadsDir = path.join(app.getPath('userData'), 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir);
        }

        const filePath = path.join(uploadsDir, `${id}.jpg`);
        const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");

        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        
        return path.join('uploads', `${id}.jpg`);
    } catch (error) {
        console.error('Failed to save photo:', error);
        throw new Error('Failed to save photo');
    }
});

ipcMain.handle('fs:deletePhoto', async (event, relativePath) => {
    return deletePhotoFile(relativePath);
});

ipcMain.handle('app:getUserDataPath', () => {
    return app.getPath('userData');
});

ipcMain.handle('db:getUsers', async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM users", [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
});

ipcMain.handle('db:addUser', (event, user) => {
    return new Promise((resolve, reject) => {
        const { id, name, email, role, area, status, photo, order_detail_id, start_date, expired_date_in, expired_date_out } = user;
        db.run(`INSERT INTO users (id, name, email, role, area, status, photo, order_detail_id, start_date, expired_date_in, expired_date_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, email, role, area, status, photo, order_detail_id, start_date, expired_date_in, expired_date_out], function(err) {
                if (err) reject(err);
                resolve({ id: this.lastID });
            }
        );
    });
});

ipcMain.handle('db:deleteUser', (event, id) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT photo FROM users WHERE id = ?", [String(id)], (err, user) => {
            if (err) return reject(err);

            db.run(`DELETE FROM users WHERE id = ?`, [String(id)], function(err) {
                if (err) return reject(err);

                if (user && user.photo) {
                    deletePhotoFile(user.photo);
                }

                resolve({ changes: this.changes });
            });
        });
    });
});

ipcMain.handle('db:bulkDeleteUsers', (event, ids) => {
    return new Promise((resolve, reject) => {
        if (!Array.isArray(ids) || ids.length === 0) {
            return resolve({ changes: 0 });
        }

        const placeholders = ids.map(() => '?').join(',');
        db.all(`SELECT photo FROM users WHERE id IN (${placeholders})`, ids, (err, rows) => {
            if (err) return reject(err);

            db.run(`DELETE FROM users WHERE id IN (${placeholders})`, ids, function (err) {
                if (err) return reject(err);

                rows.forEach(user => {
                    if (user.photo) {
                        deletePhotoFile(user.photo);
                    }
                });

                resolve({ changes: this.changes });
            });
        });
    });
});

ipcMain.handle('db:getSettings', async () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT key, value FROM settings", [], (err, rows) => {
            if (err) reject(err);
            const settings = {};
            rows.forEach(row => settings[row.key] = row.value);
            resolve(settings);
        });
    });
});

ipcMain.handle('db:setSetting', (event, key, value) => {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value], function(err) {
            if (err) {
                reject(err);
            } else {
                apiSettings[key] = value;
                resolve({ changes: this.changes });
            }
        });
    });
});

ipcMain.handle('db:getAreas', () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM areas", [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
});

ipcMain.handle('db:addArea', (event, area) => {
    return new Promise((resolve, reject) => {
        const { name, description, accessLevel } = area;
        db.run(`INSERT INTO areas (name, description, accessLevel) VALUES (?, ?, ?)`,
            [name, description, accessLevel], function(err) {
                if (err) reject(err);
                resolve({ id: this.lastID });
            }
        );
    });
});

ipcMain.handle('db:updateArea', (event, area) => {
    return new Promise((resolve, reject) => {
        const { id, name, description, accessLevel } = area;
        db.run(`UPDATE areas SET name = ?, description = ?, accessLevel = ? WHERE id = ?`,
            [name, description, accessLevel, id], function(err) {
                if (err) reject(err);
                resolve({ changes: this.changes });
            }
        );
    });
});

ipcMain.handle('db:deleteArea', (event, id) => {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM areas WHERE id = ?`, [id], function(err) {
            if (err) reject(err);
            resolve({ changes: this.changes });
        });
    });
});

ipcMain.handle('db:getDevices', () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM devices", [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
});

ipcMain.handle('db:addDevice', (event, device) => {
    return new Promise((resolve, reject) => {
        const { name, ip, area, status, lastSeen } = device;
        db.run(`INSERT INTO devices (name, ip, area, status, lastSeen) VALUES (?, ?, ?, ?, ?)`,
            [name, ip, area, status, lastSeen], function(err) {
                if (err) reject(err);
                resolve({ id: this.lastID });
            }
        );
    });
});

ipcMain.handle('db:updateDevice', (event, device) => {
    return new Promise((resolve, reject) => {
        const { id, name, ip, area, status, lastSeen } = device;
        db.run(`UPDATE devices SET name = ?, ip = ?, area = ?, status = ?, lastSeen = ? WHERE id = ?`,
            [name, ip, area, status, lastSeen, id], function(err) {
                if (err) reject(err);
                resolve({ changes: this.changes });
            }
        );
    });
});

ipcMain.handle('db:deleteDevice', (event, id) => {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM devices WHERE id = ?`, [id], function(err) {
            if (err) reject(err);
            resolve({ changes: this.changes });
        });
    });
});