// main.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');

// Set default encoding for axios responses
axios.defaults.responseType = 'json';
axios.defaults.responseEncoding = 'utf8';

let db;
let apiSettings = {};



// Helper to translate common Chinese device messages to English for readable console output
function translateDeviceMessage(msg) {
    if (!msg) return '';
    let translated = msg;

    // Common device errors
    if (msg.includes('只能支持数字字母下划线')) {
        translated = msg.replace('只能支持数字字母下划线', ' -> contains invalid characters (only numbers, letters, underscore allowed)');
        translated = translated.replace('信息', 'Info');
        translated = translated.replace('name', 'Name');
    }
    else if (msg.includes('照片重复')) {
        translated = msg.replace('照片重复', ' -> Duplicate photo detected');
    }
    else if (msg.includes('录入失败')) {
        translated = msg.replace('录入失败', 'Registration Failed');
    }
    else if (msg.includes('录入成功')) {
        translated = msg.replace('录入成功', 'Registration Success');
    }
    else if (msg.includes('成功')) {
        translated = msg.replace('成功', 'Success');
    }

    return translated;
}

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
        // Updated users table with entry_dates JSON column and face_group_id for duplicate face grouping
        db.run(`CREATE TABLE IF NOT EXISTS users (
            record_id INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL,
            name TEXT,
            email TEXT,
            role TEXT,
            area TEXT,
            status TEXT,
            photo TEXT,
            customer_id INTEGER,
            order_detail_id INTEGER,
            order_id TEXT,
            order_turnstile_id INTEGER,
            entry_dates TEXT,
            entry_period INTEGER DEFAULT 0,
            start_date TEXT,
            entry_at TEXT,
            expired_date_in TEXT,
            expired_date_out TEXT,
            is_latest INTEGER DEFAULT 0,
            face_group_id TEXT,
            device_synced INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);

        // Migration: Add new columns if they don't exist
        db.run(`ALTER TABLE users ADD COLUMN entry_dates TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Migration error:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN entry_period INTEGER DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Migration error:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN customer_id INTEGER`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Migration error:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN face_group_id TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Migration error:', err.message);
            }
        });
        db.run(`ALTER TABLE users ADD COLUMN device_synced INTEGER DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Migration error:', err.message);
            }
        });

        // Create index for faster queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_id ON users(id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_order_detail_id ON users(order_detail_id)`);

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
            apiSettings.BACKOFFICE_API_URL = "https://backoffice-api.qkiosk.ai/api";
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['BACKOFFICE_API_URL', apiSettings.BACKOFFICE_API_URL]);
        }
        if (!apiSettings.API_EMAIL) {
            apiSettings.API_EMAIL = "";
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['API_EMAIL', apiSettings.API_EMAIL]);
        }
        if (!apiSettings.API_PASSWORD) {
            apiSettings.API_PASSWORD = "";
            db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ['API_PASSWORD', apiSettings.API_PASSWORD]);
        }
        if (!apiSettings.STORE_ID) {
            apiSettings.STORE_ID = "0"; // default
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
        const {
            id, name, email, role, area, status, photo,
            customer_id, order_detail_id, order_id, order_turnstile_id,
            entry_dates, entry_period,
            start_date, entry_at, expired_date_in, expired_date_out, is_latest,
            face_group_id
        } = user;

        // Insert the new entry
        db.run(
            `INSERT INTO users (
                id, name, email, role, area, status, photo,
                customer_id, order_detail_id, order_id, order_turnstile_id,
                entry_dates, entry_period,
                start_date, entry_at, expired_date_in, expired_date_out, is_latest,
                face_group_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, name, email, role, area, status, photo,
                customer_id, order_detail_id, order_id, order_turnstile_id,
                entry_dates, entry_period,
                start_date, entry_at, expired_date_in, expired_date_out, is_latest,
                face_group_id || null
            ],
            function (err) {
                if (err) return reject(err);
                console.log(`Inserted new entry with record_id: ${this.lastID}, id: ${id}`);
                resolve({ record_id: this.lastID, id: id, changes: this.changes, operation: 'INSERT' });
            }
        );
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
                                name: user.name ? user.name.trim().split(/\s+/)[0] : '',
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

                        console.log("Sending payload to device:", device.ip);

                        // Make request with proper encoding
                        const response = await axios.post(url, payload, {
                            responseType: 'arraybuffer',
                            headers: {
                                'Content-Type': 'application/json; charset=utf-8'
                            }
                        });

                        // Decode response from arraybuffer to proper UTF-8 string
                        const responseText = Buffer.from(response.data).toString('utf8');
                        const responseData = JSON.parse(responseText);

                        console.log(`Device ${device.ip} response:`, {
                            result: responseData.result,
                            message: translateDeviceMessage(responseData.message)
                        });

                        // Check for duplicate face error (照片重复 means "duplicate photo")
                        if (responseData.result === 1 && responseData.message && responseData.message.includes('照片重复')) {
                            console.log(`Duplicate face detected on device ${device.ip}. Attempting to extract existing ID...`);

                            // Extract the existing IC number from the error message
                            // Message format: "录入失败,1760513476,1760513476与User-1037,404165280418照片重复,请检查!"
                            const regex = /与[^,]+,(\d+)照片重复/;
                            const match = responseData.message.match(regex);

                            if (match && match[1]) {
                                const existingIcno = match[1];
                                console.log(`Found existing IC number: ${existingIcno}. Retrying with this ID...`);

                                // Query the database to get the existing user's expired_date_out and face_group_id
                                let existingUserExpiredDate = null;
                                let faceGroupId = null;
                                let existingUserRecordId = null;
                                try {
                                    const existingUser = await new Promise((resolveDb, rejectDb) => {
                                        db.get(
                                            "SELECT record_id, expired_date_out, face_group_id FROM users WHERE id = ? ORDER BY entry_at DESC LIMIT 1",
                                            [existingIcno],
                                            (dbErr, row) => {
                                                if (dbErr) rejectDb(dbErr);
                                                else resolveDb(row);
                                            }
                                        );
                                    });
                                    if (existingUser) {
                                        existingUserRecordId = existingUser.record_id;
                                        if (existingUser.expired_date_out) {
                                            existingUserExpiredDate = existingUser.expired_date_out;
                                            console.log(`Found existing user's expired_date_out: ${existingUserExpiredDate}`);
                                        }
                                        // Use existing face_group_id or create new one based on the existing user's ID
                                        faceGroupId = existingUser.face_group_id || `face_${existingIcno}`;

                                        // Update existing user's face_group_id if not set
                                        if (!existingUser.face_group_id) {
                                            await new Promise((resolveUpdate, rejectUpdate) => {
                                                db.run(
                                                    "UPDATE users SET face_group_id = ? WHERE id = ?",
                                                    [faceGroupId, existingIcno],
                                                    (updateErr) => {
                                                        if (updateErr) rejectUpdate(updateErr);
                                                        else {
                                                            console.log(`Updated face_group_id for existing user ${existingIcno}: ${faceGroupId}`);
                                                            resolveUpdate();
                                                        }
                                                    }
                                                );
                                            });
                                        }
                                    }
                                } catch (dbErr) {
                                    console.error(`Error querying/updating existing user: ${dbErr.message}`);
                                }

                                // Retry with the existing IC number
                                const retryPayload = {
                                    totalnum: 1,
                                    pass: apiSettings.DEVICE_PASS,
                                    currentnum: 1,
                                    data: {
                                        usertype: "white",
                                        name: user.name ? user.name.trim().split(/\s+/)[0] : '',
                                        idno: existingIcno,
                                        icno: existingIcno,
                                        peoplestartdate: user.start_date,
                                        peopleenddate: user.expired_date_out,
                                    }
                                };

                                if (user.base64 && user.base64.trim() !== "") {
                                    retryPayload.data.picData1 = user.base64;
                                } else {
                                    retryPayload.data.passAlgo = true;
                                }

                                console.log("Retrying with existing IC number:", existingIcno);
                                const retryRes = await axios.post(url, retryPayload, {
                                    responseType: 'arraybuffer',
                                    headers: {
                                        'Content-Type': 'application/json; charset=utf-8'
                                    }
                                });
                                const retryText = Buffer.from(retryRes.data).toString('utf8');
                                const retryData = JSON.parse(retryText);

                                const deviceResult = {
                                    device: device.ip,
                                    result: retryData.result,
                                    message: retryData.message,
                                    originalId: user.id,
                                    updatedId: existingIcno,
                                    retry: true
                                };

                                // Include existing user's expired_date_out if found
                                if (existingUserExpiredDate) {
                                    deviceResult.existing_expired_date_out = existingUserExpiredDate;
                                }

                                // Include face_group_id for grouping duplicate faces
                                if (faceGroupId) {
                                    deviceResult.face_group_id = faceGroupId;
                                }

                                results.push(deviceResult);
                            } else {
                                // Could not extract ID, return original error
                                results.push({
                                    device: device.ip,
                                    result: responseData.result,
                                    message: responseData.message
                                });
                            }
                        } else {
                            // No duplicate error
                            results.push({
                                device: device.ip,
                                result: responseData.result,
                                message: responseData.message
                            });
                        }
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
// Creates ONE record per customer with all entry_dates stored as JSON (merges multiple access schedules)
// Only pushes ONCE to device with the latest end date
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

    function formatDateForDevice(date, includeTime = true) {
        const d = new Date(date);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        if (!includeTime) return `${yyyy}-${mm}-${dd}`;
        const hh = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }

    function getLatestDate(dates) {
        if (!dates || dates.length === 0) return null;
        return dates.reduce((latest, current) => {
            return new Date(current) > new Date(latest) ? current : latest;
        });
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

        // 2. Fetch access schedule details with new API format
        const syncResponse = await axios.get(
            `${apiSettings.BACKOFFICE_API_URL}/access-schedules/${encodeURIComponent(apiSettings.STORE_ID)}`,
            { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );

        const customersData = syncResponse.data?.data || [];
        if (!customersData.length) {
            console.log("No access schedule data to sync.");
            return { success: true, message: "No new users to sync." };
        }
        console.log(`Found ${customersData.length} customers with access schedule data to process.`);

        // 3. Collect access schedule details, merged per customer (handles same user with multiple tickets)
        const validOrderDetailIds = new Set();
        const customerMergedMap = new Map();

        customersData.forEach(customer => {
            const { assignee_id, name, image, access_schedules } = customer;

            if (!access_schedules || !Array.isArray(access_schedules)) return;

            access_schedules.forEach(schedule => {
                const { access_schedule_id, order_detail_id, entry_dates, entry_period } = schedule;

                if (!access_schedule_id || !order_detail_id) return;

                // Remove "-" from access_schedule_id to prevent faulty format
                const cleanedScheduleId = access_schedule_id.toString().replace(/-/g, '');

                validOrderDetailIds.add(order_detail_id);

                const existing = customerMergedMap.get(assignee_id);
                if (existing) {
                    // Same user bought another ticket - merge entry_dates and extend period
                    const mergedDates = [...new Set([...existing.entry_dates, ...(entry_dates || [])])];
                    existing.entry_dates = mergedDates;
                    existing.entry_period = Math.max(existing.entry_period, entry_period || 0);
                    existing.all_order_detail_ids.push(order_detail_id);
                    console.log(`Merged schedule ${access_schedule_id} into customer ${assignee_id} (${name}). Total dates: ${mergedDates.length}`);
                } else {
                    customerMergedMap.set(assignee_id, {
                        customer_id: assignee_id,
                        customer_name: name,
                        customer_image: image,
                        turnstile_detail_id: cleanedScheduleId,
                        order_detail_id,
                        entry_dates: entry_dates || [],
                        entry_period: entry_period || 0,
                        all_order_detail_ids: [order_detail_id]
                    });
                }
            });
        });

        const allTurnstileDetails = Array.from(customerMergedMap.values());

        console.log(`Total customers to process: ${allTurnstileDetails.length}`);
        console.log(`Valid order_detail_ids from API: ${validOrderDetailIds.size}`);

        // 4. Get all existing entries from database (keyed by order_detail_id and customer_id)
        const existingEntries = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM users WHERE order_detail_id IS NOT NULL", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        const existingEntriesMap = new Map();
        const existingEntriesByCustomerMap = new Map();
        for (const entry of existingEntries) {
            // Reformat old order_turnstile_id that still has "-" in it
            if (entry.order_turnstile_id && entry.order_turnstile_id.toString().includes('-')) {
                const cleanedId = entry.order_turnstile_id.toString().replace(/-/g, '');
                await new Promise((resolve, reject) => {
                    db.run("UPDATE users SET order_turnstile_id = ? WHERE record_id = ?", [cleanedId, entry.record_id], (err) => {
                        if (err) reject(err);
                        else {
                            console.log(`Reformatted order_turnstile_id from ${entry.order_turnstile_id} to ${cleanedId}`);
                            entry.order_turnstile_id = cleanedId;
                            resolve();
                        }
                    });
                });
            }

            // Build order_detail_id map (keep entry with latest expired_date_out)
            const existingEntry = existingEntriesMap.get(entry.order_detail_id);
            if (!existingEntry) {
                existingEntriesMap.set(entry.order_detail_id, entry);
            } else {
                const existingDate = existingEntry.expired_date_out ? new Date(existingEntry.expired_date_out) : new Date(0);
                const newDate = entry.expired_date_out ? new Date(entry.expired_date_out) : new Date(0);
                if (newDate > existingDate) {
                    console.log(`Found duplicate order_detail_id ${entry.order_detail_id}. Keeping entry with later date: ${entry.expired_date_out} over ${existingEntry.expired_date_out}`);
                    existingEntriesMap.set(entry.order_detail_id, entry);
                }
            }

            // Build customer_id map (keep entry with latest expired_date_out)
            if (entry.customer_id) {
                const existingByCustomer = existingEntriesByCustomerMap.get(entry.customer_id);
                if (!existingByCustomer) {
                    existingEntriesByCustomerMap.set(entry.customer_id, entry);
                } else {
                    const existingDate = existingByCustomer.expired_date_out ? new Date(existingByCustomer.expired_date_out) : new Date(0);
                    const newDate = entry.expired_date_out ? new Date(entry.expired_date_out) : new Date(0);
                    if (newDate > existingDate) {
                        existingEntriesByCustomerMap.set(entry.customer_id, entry);
                    }
                }
            }
        }

        // 5. Remove entries from DB that are no longer in the API response
        // Keep entries if their order_detail_id OR customer_id is still active in API
        // SAFETY: Never remove ALL entries - if removal would wipe everything, skip it
        const validCustomerIds = new Set(allTurnstileDetails.map(d => d.customer_id));
        const entriesToRemove = existingEntries.filter(entry => {
            return !validOrderDetailIds.has(entry.order_detail_id) && !validCustomerIds.has(entry.customer_id);
        });

        // Safety check: if this would remove ALL existing entries, skip removal
        // This prevents wiping the DB during API format transitions or mismatched data
        if (entriesToRemove.length > 0 && entriesToRemove.length >= existingEntries.length && existingEntries.length > 0) {
            console.log(`⚠️ SAFETY: Removal would delete ALL ${existingEntries.length} existing entries. Skipping removal to prevent data loss.`);
        } else if (entriesToRemove.length > 0) {
            console.log(`Removing ${entriesToRemove.length} entries that are no longer in API...`);

            for (const entry of entriesToRemove) {
                try {
                    await deleteUserFromAllDevicesInternal(entry.id);
                } catch (err) {
                    console.error(`Failed to remove user ${entry.id} from devices:`, err.message);
                }

                await new Promise((resolve, reject) => {
                    db.run("DELETE FROM users WHERE record_id = ?", [entry.record_id], function (err) {
                        if (err) reject(err);
                        else {
                            console.log(`Deleted entry with record_id: ${entry.record_id}`);
                            if (entry.photo) {
                                try {
                                    const fullPath = path.join(app.getPath('userData'), entry.photo);
                                    if (fs.existsSync(fullPath)) {
                                        fs.unlinkSync(fullPath);
                                    }
                                } catch (photoErr) {
                                    console.error(`Failed to delete photo:`, photoErr.message);
                                }
                            }
                            resolve();
                        }
                    });
                });
            }
        }

        // 6. Process each customer (ONE record per customer, with merged schedules)
        const results = [];
        const entryTimeLimitHours = parseInt(apiSettings.ENTRY_TIME_LIMIT) || 2;

        for (const detail of allTurnstileDetails) {
            const {
                customer_id,
                customer_name,
                customer_image,
                turnstile_detail_id,
                order_detail_id,
                entry_dates,
                entry_period,
                all_order_detail_ids
            } = detail;

            // Check by any of this customer's order_detail_ids first, then fallback to customer_id
            let existingEntry = null;
            for (const odId of (all_order_detail_ids || [order_detail_id])) {
                existingEntry = existingEntriesMap.get(odId);
                if (existingEntry) break;
            }
            if (!existingEntry) {
                existingEntry = existingEntriesByCustomerMap.get(customer_id);
                if (existingEntry) {
                    console.log(`Matched customer ${customer_id} (${customer_name}) by customer_id to existing entry record_id: ${existingEntry.record_id}`);
                }
            }

            // Calculate the latest end date from entry_dates
            const latestEntryDate = getLatestDate(entry_dates);
            const latestEntryDateTime = latestEntryDate ? new Date(latestEntryDate + "T23:59:59") : new Date();
            const exitDateTime = new Date(latestEntryDateTime.getTime() + (entryTimeLimitHours * 60 * 60 * 1000));

            // Sort entry_dates descending (most recent first)
            const sortedEntryDates = [...entry_dates].sort((a, b) => new Date(b) - new Date(a));

            if (existingEntry) {
                const newEntryDatesJson = JSON.stringify(sortedEntryDates);
                const newExitDateStr = formatDateForDevice(exitDateTime);

                // Calculate start_date and expired_date_in from API data
                const earliestEntryDate = entry_dates.length > 0
                    ? entry_dates.reduce((earliest, current) => new Date(current) < new Date(earliest) ? current : earliest)
                    : formatDateForDevice(now, false);
                const newStartDateStr = formatDateForDevice(new Date(earliestEntryDate + "T00:00:00"));
                const newExpiredDateInStr = formatDateForDevice(latestEntryDateTime);

                // Compare new exit date with existing expired_date_out and use the LATEST one
                let finalExitDateTime = exitDateTime;
                let finalExitDateStr = newExitDateStr;
                if (existingEntry.expired_date_out) {
                    const existingExitDate = new Date(existingEntry.expired_date_out);
                    if (existingExitDate > exitDateTime) {
                        console.log(`Existing expired_date_out (${existingEntry.expired_date_out}) is later than new calculated date (${newExitDateStr}). Keeping existing.`);
                        finalExitDateTime = existingExitDate;
                        finalExitDateStr = existingEntry.expired_date_out;
                    } else {
                        console.log(`New calculated date (${newExitDateStr}) is later than existing (${existingEntry.expired_date_out}). Using new date.`);
                    }
                }

                // Check if photo needs updating from API
                const photoNeedsUpdate = needsPhotoUpdate(existingEntry.photo, customer_image);
                let newPhotoPath = existingEntry.photo;
                let newBase64Image = null;

                if (photoNeedsUpdate && customer_image) {
                    try {
                        const imgBase64 = await getImageBase64(customer_image);
                        if (imgBase64) {
                            const cleanBase64 = imgBase64.replace(/^data:image\/\w+;base64,/, "");
                            newBase64Image = cleanBase64;
                            const buffer = Buffer.from(cleanBase64, "base64");
                            const fileName = `${customer_id}_${order_detail_id}_${Date.now()}.jpg`;
                            const uploadsDir = path.join(app.getPath("userData"), "uploads");
                            fs.mkdirSync(uploadsDir, { recursive: true });
                            const fullPath = path.join(uploadsDir, fileName);
                            fs.writeFileSync(fullPath, buffer);

                            // Delete old photo file if it exists and is different
                            if (existingEntry.photo && existingEntry.photo !== path.join("uploads", fileName)) {
                                try {
                                    const oldPath = path.join(app.getPath('userData'), existingEntry.photo);
                                    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                                } catch (e) { /* ignore */ }
                            }

                            newPhotoPath = path.join("uploads", fileName);
                            console.log(`📸 Updated photo for customer ${customer_id}: ${newPhotoPath}`);
                        }
                    } catch (imgErr) {
                        console.error(`Failed to download/save updated photo for customer ${customer_id}:`, imgErr.message);
                    }
                }

                // Check change detection
                const datesChanged = existingEntry.entry_dates !== newEntryDatesJson;
                const periodChanged = existingEntry.entry_period !== entry_period;
                const expiryChanged = existingEntry.expired_date_out !== finalExitDateStr;
                const nameChanged = customer_name && existingEntry.name !== customer_name;
                const startDateChanged = existingEntry.start_date !== newStartDateStr;
                const expiredDateInChanged = existingEntry.expired_date_in !== newExpiredDateInStr;
                const photoChanged = newPhotoPath !== existingEntry.photo;

                if (!datesChanged && !periodChanged && !expiryChanged && !nameChanged && !startDateChanged && !expiredDateInChanged && !photoChanged) {
                    console.log(`No changes for order_detail_id ${order_detail_id}, skipping DB/Device update.`);
                    results.push({ order_detail_id, updated: false, message: "No changes detected" });
                    continue;
                }

                // Update existing entry with new data including photo
                console.log(`Updating existing entry record_id ${existingEntry.record_id} for customer ${customer_id} with start_date: ${newStartDateStr}, expired_date_in: ${newExpiredDateInStr}, expired_date_out: ${finalExitDateStr}, photo updated: ${photoChanged}`);

                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE users SET
                            entry_dates = ?,
                            entry_period = ?,
                            start_date = ?,
                            expired_date_in = ?,
                            expired_date_out = ?,
                            name = ?,
                            photo = ?,
                            order_detail_id = ?,
                            order_turnstile_id = ?,
                            customer_id = ?
                        WHERE record_id = ?`,
                        [
                            JSON.stringify(sortedEntryDates),
                            entry_period,
                            newStartDateStr,
                            newExpiredDateInStr,
                            finalExitDateStr,
                            customer_name || existingEntry.name,
                            newPhotoPath,
                            order_detail_id,
                            turnstile_detail_id,
                            customer_id,
                            existingEntry.record_id
                        ],
                        function (err) {
                            if (err) reject(err);
                            else resolve({ changes: this.changes });
                        }
                    );
                });

                // Update device with the correct dates and photo
                let deviceSynced = 0;
                let deviceResults = [];
                try {
                    // If we have a freshly downloaded photo, pass it directly to avoid re-reading from disk
                    deviceResults = await updateUserOnAllDevices({
                        id: existingEntry.id,
                        name: customer_name || existingEntry.name,
                        start_date: newStartDateStr,
                        expired_date_out: finalExitDateStr,
                        base64Override: newBase64Image || null
                    });
                    const anySuccess = Array.isArray(deviceResults)
                        ? deviceResults.some(r => r.result === 0 || r.result === 1)
                        : (deviceResults && (deviceResults.result === 0 || deviceResults.result === 1));
                    deviceSynced = anySuccess ? 1 : 0;
                } catch (deviceErr) {
                    console.error(`Failed to sync updated user ${existingEntry.id} to devices:`, deviceErr.message);
                    deviceSynced = 0;
                }

                // Update device_synced status
                await new Promise((resolve, reject) => {
                    db.run("UPDATE users SET device_synced = ? WHERE record_id = ?", [deviceSynced, existingEntry.record_id], (err) => {
                        if (err) reject(err); else resolve();
                    });
                });

                results.push({
                    order_detail_id,
                    updated: true,
                    deviceResults,
                    deviceSynced,
                    message: "Updated existing entry"
                });
                continue;
            }

            // Create new entry
            const entryId = generateUniqueId();

            // Download and save image
            let base64Image = null;
            let photoPath = null;

            if (customer_image) {
                const imgBase64 = await getImageBase64(customer_image);
                if (imgBase64) {
                    const cleanBase64 = imgBase64.replace(/^data:image\/\w+;base64,/, "");
                    base64Image = cleanBase64;
                    try {
                        const buffer = Buffer.from(cleanBase64, "base64");
                        const fileName = `${customer_id}_${order_detail_id}_${Date.now()}.jpg`;
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

            // Get the earliest date for start_date
            const earliestEntryDate = entry_dates.length > 0
                ? entry_dates.reduce((earliest, current) => new Date(current) < new Date(earliest) ? current : earliest)
                : formatDateForDevice(now, false);

            // Create user object
            const user = {
                id: entryId,
                name: customer_name || `Customer-${customer_id}`,
                email: null,
                role: "guest",
                area: "default",
                status: "Paid",
                photo: photoPath,
                base64: base64Image,
                customer_id: customer_id,
                order_detail_id: order_detail_id,
                order_id: order_detail_id.toString(),
                order_turnstile_id: turnstile_detail_id,
                entry_dates: JSON.stringify(sortedEntryDates),
                entry_period: entry_period,
                start_date: formatDateForDevice(new Date(earliestEntryDate + "T00:00:00")),
                entry_at: formatDateForDevice(new Date(earliestEntryDate + "T00:00:00")),
                expired_date_in: formatDateForDevice(latestEntryDateTime),
                expired_date_out: formatDateForDevice(exitDateTime),
                is_latest: 1
            };

            // Add to database
            const dbResult = await addUserToDB(user);
            console.log(`Added new entry for ${user.name}, order_detail_id: ${order_detail_id}`);

            // Sync to devices (only once per user with the latest end date)
            let deviceSynced = 0;
            let deviceResults = [];
            try {
                deviceResults = await addUserToAllDevices(user);
                // Check if at least one device succeeded
                const anySuccess = Array.isArray(deviceResults)
                    ? deviceResults.some(r => r.result === 0 || r.result === 1)
                    : (deviceResults && (deviceResults.result === 0 || deviceResults.result === 1));
                deviceSynced = anySuccess ? 1 : 0;
                console.log(`Synced to devices for ${user.name}:`, deviceResults);
            } catch (deviceErr) {
                console.error(`Failed to sync ${user.name} to devices:`, deviceErr.message);
                deviceSynced = 0;
            }

            // Update device_synced status in DB
            await new Promise((resolve, reject) => {
                db.run("UPDATE users SET device_synced = ? WHERE id = ?", [deviceSynced, entryId], (err) => {
                    if (err) reject(err); else resolve();
                });
            });

            results.push({
                order_detail_id,
                entryId,
                dbResult,
                deviceResults,
                deviceSynced,
                success: true,
                created: true
            });
        }

        const newUsers = results.filter(r => r.created).length;
        const updatedUsers = results.filter(r => r.updated).length;
        const removedUsers = entriesToRemove.length;

        return {
            success: true,
            message: `Sync completed. New: ${newUsers}, Updated: ${updatedUsers}, Removed: ${removedUsers}`,
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

// Helper function to delete user from all devices (internal use)
async function deleteUserFromAllDevicesInternal(idno) {
    return new Promise((resolve, reject) => {
        db.all("SELECT ip FROM devices", [], async (err, devices) => {
            if (err) return reject(err);
            if (!devices || devices.length === 0) {
                return resolve([]);
            }

            const results = [];
            for (const device of devices) {
                const url = `http://${device.ip}:9090/deleteDeviceWhiteList`;
                try {
                    const status = await getDeviceStatus(device.ip);
                    if (status === 'online') {
                        const response = await axios.post(url, {
                            pass: apiSettings.DEVICE_PASS,
                            data: {
                                idno: idno,
                                usertype: "white"
                            }
                        }, {
                            responseType: 'arraybuffer',
                            headers: { 'Content-Type': 'application/json; charset=utf-8' }
                        });

                        const responseText = Buffer.from(response.data).toString('utf8');
                        const responseData = JSON.parse(responseText);

                        console.log(`Delete from device ${device.ip}:`, {
                            ...responseData,
                            message: translateDeviceMessage(responseData.message)
                        });
                        results.push({ device: device.ip, result: responseData.result, message: responseData.message });
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
}

// Helper function to update user on all devices (dates + photo)
async function updateUserOnAllDevices(user) {
    return new Promise((resolve, reject) => {
        db.all("SELECT id, ip FROM devices", [], async (err, devices) => {
            if (err) return reject({ result: -1, message: "Failed to get devices from DB." });
            if (devices.length === 0) {
                return resolve([{ result: 1, message: "No devices found in local database." }]);
            }

            // Use freshly downloaded photo if provided, otherwise load from DB
            let base64Image = user.base64Override || null;
            if (!base64Image) {
                try {
                    const userRecord = await new Promise((resolveDb, rejectDb) => {
                        db.get("SELECT photo FROM users WHERE id = ?", [user.id], (err2, row) => {
                            if (err2) rejectDb(err2); else resolveDb(row);
                        });
                    });
                    if (userRecord && userRecord.photo) {
                        const fullPath = path.join(app.getPath('userData'), userRecord.photo);
                        if (fs.existsSync(fullPath)) {
                            base64Image = fs.readFileSync(fullPath).toString('base64');
                        }
                    }
                } catch (photoErr) {
                    console.log('Could not load photo for device update:', photoErr.message);
                }
            }

            const results = [];

            for (const device of devices) {
                try {
                    const status = await getDeviceStatus(device.ip);
                    if (status === "online") {
                        // Step 1: Delete the user from device first so both start and end dates are refreshed
                        const deleteUrl = `http://${device.ip}:9090/deleteDeviceWhiteList`;
                        try {
                            await axios.post(deleteUrl, {
                                pass: apiSettings.DEVICE_PASS,
                                data: {
                                    idno: user.id,
                                    usertype: "white"
                                }
                            }, {
                                responseType: 'arraybuffer',
                                headers: { 'Content-Type': 'application/json; charset=utf-8' }
                            });
                            console.log(`Deleted user ${user.id} from device ${device.ip} before re-adding with updated dates`);
                        } catch (delErr) {
                            console.log(`Delete before update failed on ${device.ip} (may not exist yet): ${delErr.message}`);
                        }

                        // Step 2: Re-add the user with updated start and end dates
                        const addUrl = `http://${device.ip}:9090/addDeviceWhiteList`;
                        const payload = {
                            totalnum: 1,
                            pass: apiSettings.DEVICE_PASS,
                            currentnum: 1,
                            data: {
                                usertype: "white",
                                name: user.name ? user.name.trim().split(/\s+/)[0] : '',
                                idno: user.id,
                                icno: user.id,
                                peoplestartdate: user.start_date || user.expired_date_out.split(' ')[0] + ' 00:00:00',
                                peopleenddate: user.expired_date_out,
                            }
                        };

                        // Include photo if available, otherwise use passAlgo
                        if (base64Image && base64Image.trim() !== "") {
                            payload.data.picData1 = base64Image;
                        } else {
                            payload.data.passAlgo = true;
                        }

                        console.log(`Re-adding user on device ${device.ip} with start: ${payload.data.peoplestartdate}, end: ${payload.data.peopleenddate}`);

                        const response = await axios.post(addUrl, payload, {
                            responseType: 'arraybuffer',
                            headers: { 'Content-Type': 'application/json; charset=utf-8' }
                        });

                        const responseText = Buffer.from(response.data).toString('utf8');
                        const responseData = JSON.parse(responseText);

                        console.log(`Device ${device.ip} update response:`, {
                            ...responseData,
                            message: translateDeviceMessage(responseData.message)
                        });

                        // Handle duplicate face: old face data exists under a different idno on the device
                        if (responseData.result === 1 && responseData.message && responseData.message.includes('照片重复')) {
                            console.log(`Duplicate face detected on device ${device.ip}. Extracting old ID to delete...`);
                            const regex = /与[^,]+,(\d+)照片重复/;
                            const match = responseData.message.match(regex);

                            if (match && match[1]) {
                                const existingIcno = match[1];
                                console.log(`Found old device ID: ${existingIcno}. Deleting old entry then re-adding...`);

                                // Delete the old entry that has the conflicting face
                                try {
                                    await axios.post(deleteUrl, {
                                        pass: apiSettings.DEVICE_PASS,
                                        data: { idno: existingIcno, usertype: "white" }
                                    }, {
                                        responseType: 'arraybuffer',
                                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                                    });
                                    console.log(`Deleted old entry ${existingIcno} from device ${device.ip}`);
                                } catch (delErr2) {
                                    console.log(`Failed to delete old entry ${existingIcno}: ${delErr2.message}`);
                                }

                                // Re-add with the new photo and dates
                                try {
                                    const retryResponse = await axios.post(addUrl, payload, {
                                        responseType: 'arraybuffer',
                                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                                    });
                                    const retryText = Buffer.from(retryResponse.data).toString('utf8');
                                    const retryData = JSON.parse(retryText);

                                    console.log(`Device ${device.ip} retry response:`, {
                                        ...retryData,
                                        message: translateDeviceMessage(retryData.message)
                                    });

                                    results.push({
                                        device: device.ip,
                                        result: retryData.result,
                                        message: `(Retry after deleting old face ${existingIcno}) ${retryData.message}`
                                    });
                                    continue;
                                } catch (retryErr) {
                                    results.push({
                                        device: device.ip,
                                        result: -1,
                                        message: `Retry failed after deleting old face: ${retryErr.message}`
                                    });
                                    continue;
                                }
                            }
                        }

                        results.push({
                            device: device.ip,
                            result: responseData.result,
                            message: responseData.message
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

function startApiServer() {
    const appServer = express();
    const PORT = 3000;

    appServer.use(cors());
    appServer.use(bodyParser.json({ limit: '10mb' }));

    appServer.post('/api/add', async (req, res) => {
        const { icno, user_image } = req.body;

        console.log("\n========================================");
        console.log("📥 /api/add REQUEST RECEIVED");
        console.log("========================================");

        try {
            if (!icno || icno.trim() === "") {
                throw new Error("IC number (icno) is required");
            }

            const orderDetailId = req.body.order_detail_id || null;
            const orderId = req.body.order_id || null;
            const newExpiredDateOut = req.body.expired_date_out || null;
            const newStartDate = req.body.start_date || null;

            console.log("📋 Input Data:");
            console.log(`   - icno: ${icno}`);
            console.log(`   - order_id: ${orderId}`);
            console.log(`   - order_detail_id: ${orderDetailId}`);
            console.log(`   - start_date: ${newStartDate}`);
            console.log(`   - expired_date_out: ${newExpiredDateOut}`);
            console.log(`   - has_image: ${user_image ? 'YES' : 'NO'}`);

            // Save photo first
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
                console.log(`📸 Photo saved: ${photoPath}`);
            }

            // Extract entry_dates from start_date
            let entryDates = null;
            if (newStartDate) {
                const startDateStr = newStartDate.split(' ')[0];
                entryDates = JSON.stringify([startDateStr]);
            }

            // Build user object
            const user = {
                id: icno,
                name: req.body.name || icno,
                email: req.body.email || null,
                role: "guest",
                area: "default",
                status: "Paid",
                base64: user_image || null,
                photo: photoPath || null,
                order_detail_id: orderDetailId,
                order_id: orderId,
                entry_dates: entryDates,
                entry_period: 1,
                start_date: newStartDate,
                entry_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
                expired_date_in: req.body.expired_date_in || null,
                expired_date_out: newExpiredDateOut
            };

            // STEP 1: Try to add user to devices first to check for duplicate face
            console.log("\n🔄 STEP 1: Sending user to devices to check for duplicate face...");
            const deviceResults = await addUserToAllDevices(user);

            console.log("📡 Device Results:");
            deviceResults.forEach((dr, i) => {
                console.log(`   Device ${i + 1} (${dr.device}):`);
                console.log(`      - result: ${dr.result}`);
                console.log(`      - message: ${dr.message}`);
                console.log(`      - retry: ${dr.retry || false}`);
                console.log(`      - updatedId: ${dr.updatedId || 'N/A'}`);
                console.log(`      - face_group_id: ${dr.face_group_id || 'N/A'}`);
                console.log(`      - existing_expired_date_out: ${dr.existing_expired_date_out || 'N/A'}`);
            });

            let duplicateFaceDetected = false;
            let existingDeviceId = null;
            let faceGroupId = null;
            let existingExpiredDateOut = null;

            // Check device results for duplicate face detection
            for (const deviceResult of deviceResults) {
                if (deviceResult.retry && deviceResult.updatedId) {
                    duplicateFaceDetected = true;
                    existingDeviceId = deviceResult.updatedId;
                    faceGroupId = deviceResult.face_group_id || `face_${existingDeviceId}`;
                    existingExpiredDateOut = deviceResult.existing_expired_date_out || null;
                    break;
                }
            }

            console.log("\n🔍 Duplicate Detection Result:");
            console.log(`   - duplicateFaceDetected: ${duplicateFaceDetected}`);
            console.log(`   - existingDeviceId: ${existingDeviceId || 'N/A'}`);
            console.log(`   - faceGroupId: ${faceGroupId || 'N/A'}`);
            console.log(`   - existingExpiredDateOut: ${existingExpiredDateOut || 'N/A'}`);

            let dbResult;

            if (duplicateFaceDetected && existingDeviceId) {
                // DUPLICATE FACE: Find existing user in DB and update OR create new entry linked to same face
                console.log("\n🔄 STEP 2: DUPLICATE FACE - Checking database for existing entry...");

                // Check if this order_detail_id already exists
                let existingEntry = null;

                if (orderDetailId) {
                    console.log(`   Searching by order_detail_id: ${orderDetailId}`);
                    existingEntry = await new Promise((resolve, reject) => {
                        db.get("SELECT * FROM users WHERE order_detail_id = ?", [orderDetailId], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    console.log(`   Result: ${existingEntry ? `Found record_id ${existingEntry.record_id}` : 'Not found'}`);
                }

                // Also check by order_id + icno
                if (!existingEntry && orderId) {
                    console.log(`   Searching by icno + order_id: ${icno} + ${orderId}`);
                    existingEntry = await new Promise((resolve, reject) => {
                        db.get("SELECT * FROM users WHERE id = ? AND order_id = ?", [icno, orderId], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    console.log(`   Result: ${existingEntry ? `Found record_id ${existingEntry.record_id}` : 'Not found'}`);
                }

                // Check by existing device ID (the face is registered under this ID)
                if (!existingEntry) {
                    console.log(`   Searching by existingDeviceId: ${existingDeviceId}`);
                    existingEntry = await new Promise((resolve, reject) => {
                        db.get("SELECT * FROM users WHERE id = ? ORDER BY entry_at DESC LIMIT 1", [existingDeviceId], (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    console.log(`   Result: ${existingEntry ? `Found record_id ${existingEntry.record_id}` : 'Not found'}`);
                }

                if (existingEntry) {
                    console.log("\n📋 Existing Entry Found:");
                    console.log(`   - record_id: ${existingEntry.record_id}`);
                    console.log(`   - id: ${existingEntry.id}`);
                    console.log(`   - order_id: ${existingEntry.order_id}`);
                    console.log(`   - order_detail_id: ${existingEntry.order_detail_id}`);
                    console.log(`   - expired_date_out: ${existingEntry.expired_date_out}`);

                    // Update existing entry's end date if new date is later
                    const existingDate = new Date(existingEntry.expired_date_out || '1970-01-01');
                    const newDate = new Date(newExpiredDateOut);

                    console.log(`\n📅 Date Comparison:`);
                    console.log(`   - Existing date: ${existingEntry.expired_date_out} (${existingDate.getTime()})`);
                    console.log(`   - New date: ${newExpiredDateOut} (${newDate.getTime()})`);
                    console.log(`   - New date is later: ${newDate > existingDate}`);

                    if (newDate > existingDate) {
                        console.log("\n✅ Updating existing entry with new end date...");

                        await new Promise((resolve, reject) => {
                            db.run(
                                `UPDATE users SET expired_date_out = ?, face_group_id = ?, entry_at = ? WHERE record_id = ?`,
                                [newExpiredDateOut, faceGroupId, new Date().toISOString().replace('T', ' ').slice(0, 19), existingEntry.record_id],
                                function (err) {
                                    if (err) reject(err);
                                    else {
                                        console.log(`   Database UPDATE completed. Changes: ${this.changes}`);
                                        resolve();
                                    }
                                }
                            );
                        });

                        // Update device with new end date using the existing device ID
                        console.log(`\n📡 Updating device with new end date for ID: ${existingDeviceId}`);
                        const deviceUpdateResults = await updateUserOnAllDevices({
                            id: existingDeviceId,
                            name: existingEntry.name,
                            start_date: existingEntry.start_date,
                            expired_date_out: newExpiredDateOut
                        });
                        console.log("   Device update results:", JSON.stringify(deviceUpdateResults, null, 2));

                        dbResult = {
                            record_id: existingEntry.record_id,
                            id: existingEntry.id,
                            changes: 1,
                            operation: 'UPDATE',
                            duplicate_face: true,
                            existing_device_id: existingDeviceId,
                            previous_expired_date_out: existingEntry.expired_date_out,
                            new_expired_date_out: newExpiredDateOut
                        };
                    } else {
                        console.log("\n⏭️ SKIPPING - New date is not later than existing date");
                        dbResult = {
                            record_id: existingEntry.record_id,
                            id: existingEntry.id,
                            changes: 0,
                            operation: 'SKIP',
                            duplicate_face: true,
                            reason: 'New date is not later than existing date'
                        };
                    }
                } else {
                    // No existing entry in DB - create new entry but link to same face group
                    console.log("\n📝 No existing entry found. Creating NEW entry with face_group_id...");

                    user.face_group_id = faceGroupId;
                    dbResult = await addUserToDB(user);
                    console.log(`   New entry created with record_id: ${dbResult.record_id}`);

                    // Update device with the new end date using existing device ID
                    console.log(`\n📡 Updating device end date for existing ID: ${existingDeviceId}`);
                    const deviceUpdateResults = await updateUserOnAllDevices({
                        id: existingDeviceId,
                        name: user.name,
                        start_date: user.start_date,
                        expired_date_out: newExpiredDateOut
                    });
                    console.log("   Device update results:", JSON.stringify(deviceUpdateResults, null, 2));

                    dbResult.duplicate_face = true;
                    dbResult.existing_device_id = existingDeviceId;
                    dbResult.face_group_id = faceGroupId;
                }
            } else {
                // NO DUPLICATE: Create new entry normally
                console.log("\n🔄 STEP 2: NO DUPLICATE FACE - Creating new user entry...");

                dbResult = await addUserToDB(user);
                dbResult.duplicate_face = false;
                console.log(`   New entry created with record_id: ${dbResult.record_id}`);
            }

            console.log("\n========================================");
            console.log("✅ /api/add RESPONSE");
            console.log("========================================");
            console.log("DB Result:", JSON.stringify(dbResult, null, 2));
            console.log("========================================\n");

            res.json({
                success: true,
                message: duplicateFaceDetected ? "User linked to existing face" : "User added successfully",
                db: dbResult,
                devices: deviceResults
            });
        } catch (err) {
            console.error("\n========================================");
            console.error("❌ /api/add ERROR:", err);
            console.error("========================================\n");
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

                // Extract entry_dates from start_date (just the date part) to align with API sync structure
                let entryDates = null;
                if (userData.start_date) {
                    // Extract date part from "2026-01-02 11:33:19" -> "2026-01-02"
                    const startDateStr = userData.start_date.split(' ')[0];
                    entryDates = JSON.stringify([startDateStr]);
                }

                const user = {
                    id: icno,
                    name: userData.name || icno,
                    email: userData.email || null,
                    role: "guest",
                    area: "default",
                    status: "Unpaid", // Changed from null to "Unpaid"
                    base64: user_image || null,
                    photo: photoPath || null,
                    order_detail_id: userData.order_detail_id || null,
                    order_id: userData.order_id || null,
                    order_turnstile_id: null,
                    entry_dates: entryDates,
                    entry_period: 1, // Default to 1 entry for offline adds
                    start_date: userData.start_date || null,
                    entry_at: userData.start_date || null,
                    expired_date_in: userData.start_date || null,
                    expired_date_out: userData.expired_date_out || null,
                    is_latest: 1 // Mark as latest entry
                };

                // Add user to database
                const dbResult = await addUserToDB(user);

                results.push({
                    icno,
                    success: true,
                    db: dbResult,
                    message: "User added to database with Unpaid status"
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

    appServer.post('/api/webhook/device', (req, res) => {
        console.log('\n=================================================');
        console.log('📥 INCOMING REQUEST FROM THIRD-PARTY DEVICE');
        console.log('=================================================');
        console.log('Timestamp:', new Date().toISOString());

        // Extract only the specific fields
        const { icNum, id, idNum, time } = req.body;

        console.log('\n--- EXTRACTED DATA ---');
        console.log('icNum:', icNum);
        console.log('id:', id);
        console.log('idNum:', idNum);
        console.log('time:', time);
        console.log('\n=================================================\n');

        // Send a success response back to the device
        res.status(200).json({
            success: true,
            message: 'Data received successfully',
            timestamp: new Date().toISOString()
        });
    });

    appServer.get('/api/webhook/device', (req, res) => {
        console.log('\n=================================================');
        console.log('📥 INCOMING GET REQUEST FROM THIRD-PARTY DEVICE');
        console.log('=================================================');
        console.log('Timestamp:', new Date().toISOString());
        console.log('\n--- REQUEST HEADERS ---');
        console.log(JSON.stringify(req.headers, null, 2));
        console.log('\n--- REQUEST QUERY PARAMS ---');
        console.log(JSON.stringify(req.query, null, 2));
        console.log('\n=================================================\n');

        // Send a success response back to the device
        res.status(200).json({
            success: true,
            message: 'GET request received successfully',
            timestamp: new Date().toISOString()
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


ipcMain.handle('addUserToDevices', async (event, recordId) => {
    try {
        // Fetch user from DB
        const userFromDB = await getUserFromDB(recordId);
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
                    break;
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
        console.log(`Received db:updateUser request for ID: ${id}`);

        // Get the latest entry for this user - reliable query using record_id
        const latestUser = await new Promise((resolve, reject) => {
            db.get(
                "SELECT * FROM users WHERE id = ? ORDER BY record_id DESC LIMIT 1",
                [id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!latestUser) {
            console.error(`User with ID ${id} not found in database.`);
            throw new Error(`User with ID ${id} not found`);
        }
        console.log(`Found user record ID: ${latestUser.record_id}`);

        // Step 1: Update in database
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET name = ?, start_date = ?, expired_date_in = ?, expired_date_out = ? WHERE record_id = ?`,
                [name, start_date, expired_date_in, expired_date_out, latestUser.record_id],
                function (err) {
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

        // Step 2: Get updated user data from database (including photo)
        const fullUser = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE record_id = ?", [latestUser.record_id], (err, row) => {
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
            try {
                const status = await getDeviceStatus(device.ip);

                if (status === "online") {
                    // Step 1: Delete user from device first so both start and end dates are refreshed
                    const deleteUrl = `http://${device.ip}:9090/deleteDeviceWhiteList`;
                    try {
                        await axios.post(deleteUrl, {
                            pass: apiSettings.DEVICE_PASS,
                            data: {
                                idno: fullUser.id,
                                usertype: "white"
                            }
                        }, {
                            responseType: 'arraybuffer',
                            headers: { 'Content-Type': 'application/json; charset=utf-8' }
                        });
                        console.log(`🗑️ Deleted user ${fullUser.id} from device ${device.ip} before re-adding`);
                    } catch (delErr) {
                        console.log(`Delete before update failed on ${device.ip} (may not exist yet): ${delErr.message}`);
                    }

                    // Step 2: Re-add user with updated start and end dates
                    const addUrl = `http://${device.ip}:9090/addDeviceWhiteList`;
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

                    if (base64Image && base64Image.trim() !== "") {
                        payload.data.picData1 = base64Image;
                    } else {
                        payload.data.passAlgo = true;
                    }

                    console.log(`📤 Re-adding user to device ${device.ip} with start: ${payload.data.peoplestartdate}, end: ${payload.data.peopleenddate}`);

                    const response = await axios.post(addUrl, payload, {
                        responseType: 'arraybuffer',
                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                    });

                    const responseText = Buffer.from(response.data).toString('utf8');
                    const responseData = JSON.parse(responseText);

                    // Check for duplicate face error
                    if (responseData.result === 1 && responseData.message && responseData.message.includes('照片重复')) {
                        console.log(`Duplicate face detected on device ${device.ip}. Attempting to extract existing ID...`);

                        const regex = /与[^,]+,(\d+)照片重复/;
                        const match = responseData.message.match(regex);

                        if (match && match[1]) {
                            const existingIcno = match[1];
                            console.log(`Found existing device ID: ${existingIcno}. Retrying update with this ID...`);

                            // Delete the existing entry by its device ID too
                            try {
                                await axios.post(deleteUrl, {
                                    pass: apiSettings.DEVICE_PASS,
                                    data: { idno: existingIcno, usertype: "white" }
                                }, {
                                    responseType: 'arraybuffer',
                                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                                });
                            } catch (delErr2) {
                                console.log(`Delete existing ID ${existingIcno} failed: ${delErr2.message}`);
                            }

                            const retryPayload = {
                                ...payload,
                                data: {
                                    ...payload.data,
                                    idno: existingIcno,
                                    icno: existingIcno,
                                    name: existingIcno
                                }
                            };

                            const retryResponse = await axios.post(addUrl, retryPayload, {
                                responseType: 'arraybuffer',
                                headers: { 'Content-Type': 'application/json; charset=utf-8' }
                            });

                            const retryText = Buffer.from(retryResponse.data).toString('utf8');
                            const retryData = JSON.parse(retryText);

                            deviceResults.push({
                                device: device.ip,
                                result: retryData.result,
                                message: `(Retry) ${retryData.message}`,
                                success: retryData.result === 0
                            });

                            if (retryData.result === 0) {
                                console.log(`✅ Successfully synced to device ${device.ip} (using existing ID: ${existingIcno})`);
                            } else {
                                console.log(`⚠️ Device ${device.ip} retry failed: ${retryData.message}`);
                            }
                            continue;
                        }
                    }

                    deviceResults.push({
                        device: device.ip,
                        result: responseData.result,
                        message: responseData.message,
                        success: responseData.result === 0
                    });

                    if (responseData.result === 0) {
                        console.log(`✅ Successfully synced to device ${device.ip}`);
                    } else {
                        console.log(`⚠️ Device ${device.ip} returned non-zero result: ${responseData.message}`);
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
function getUserFromDB(recordId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE record_id = ?", [recordId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

ipcMain.handle('updateUserStatus', async (event, recordId, status) => {
    return new Promise((resolve, reject) => {
        const sql = "UPDATE users SET status = ? WHERE record_id = ?";
        db.run(sql, [status, recordId], function (err) {
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

ipcMain.handle('api:resyncUserToDevices', async (event, recordId) => {
    try {
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM users WHERE record_id = ?", [recordId], (err, row) => {
                if (err) reject(err); else resolve(row);
            });
        });
        if (!user) return { success: false, message: "User not found" };

        // Read photo base64 if available
        let base64Image = null;
        if (user.photo) {
            try {
                const fullPath = path.join(app.getPath('userData'), user.photo);
                if (fs.existsSync(fullPath)) {
                    base64Image = fs.readFileSync(fullPath).toString('base64');
                }
            } catch (e) { /* ignore */ }
        }

        const deviceResults = await addUserToAllDevices({
            id: user.id,
            name: user.name,
            start_date: user.start_date,
            expired_date_out: user.expired_date_out,
            base64: base64Image
        });

        const anySuccess = Array.isArray(deviceResults)
            ? deviceResults.some(r => r.result === 0 || r.result === 1)
            : (deviceResults && (deviceResults.result === 0 || deviceResults.result === 1));
        const deviceSynced = anySuccess ? 1 : 0;

        await new Promise((resolve, reject) => {
            db.run("UPDATE users SET device_synced = ? WHERE record_id = ?", [deviceSynced, recordId], (err) => {
                if (err) reject(err); else resolve();
            });
        });

        return { success: true, deviceSynced, deviceResults };
    } catch (err) {
        console.error("Resync error:", err);
        return { success: false, message: err.message };
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
                                name: user.name ? user.name.trim().split(/\s+/)[0] : '',
                                idno: user.id,
                                peoplestartdate: user.start_date,
                                peopleenddate: user.expired_date_out,
                                picData1: user.base64
                            }
                        }, {
                            responseType: 'arraybuffer',
                            headers: { 'Content-Type': 'application/json; charset=utf-8' }
                        });

                        const responseText = Buffer.from(response.data).toString('utf8');
                        const responseData = JSON.parse(responseText);

                        console.log(`Device ${device.ip} response:`, {
                            ...responseData,
                            message: translateDeviceMessage(responseData.message)
                        });
                        results.push({ device: device.ip, result: responseData.result, message: responseData.message });
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
                    }, {
                        responseType: 'arraybuffer',
                        headers: { 'Content-Type': 'application/json; charset=utf-8' }
                    });

                    const responseText = Buffer.from(response.data).toString('utf8');
                    const responseData = JSON.parse(responseText);

                    console.log(`Delete from device ${device.ip}:`, {
                        ...responseData,
                        message: translateDeviceMessage(responseData.message)
                    });
                    results.push({ device: device.ip, result: responseData.result, message: responseData.message });
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
                const response = await axios.post(url, { pass: apiSettings.DEVICE_PASS }, {
                    responseType: 'arraybuffer',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                });

                const responseText = Buffer.from(response.data).toString('utf8');
                const responseData = JSON.parse(responseText);

                resolve(responseData);
            } catch (error) {
                reject({ result: -1, message: `Failed to open gate: ${error.message}` });
            }
        });
    });
});

ipcMain.handle('api:updateOrderStatus', async (_event, orderNumber) => {
    try {
        // Ensure the base URL is properly formatted
        let baseUrl = apiSettings.BACKOFFICE_API_URL || '';
        // Remove trailing slash if exists
        baseUrl = baseUrl.replace(/\/$/, '');

        console.log(`Authenticating to backend API: ${baseUrl}`);

        // 1. Authenticate to get bearer token
        const loginResponse = await axios.post(`${baseUrl}/auth/login`, null, {
            params: {
                email: apiSettings.API_EMAIL,
                password: apiSettings.API_PASSWORD,
            },
        });

        const rawToken = loginResponse.data?.data?.token || "";
        const token = rawToken.includes("|") ? rawToken.split("|")[1].trim() : rawToken.trim();

        console.log(`Login successful. Updating order status for ${orderNumber} to Paid`);

        // 2. Update order status with bearer token
        const response = await axios.patch(
            `${baseUrl}/orders/status/update`,
            {
                order_number: orderNumber,
                status_name: 'Paid'
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        console.log(`Order ${orderNumber} status updated to Paid in backend:`, response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('Error updating order status:', error.response?.data || error.message);
        console.error('Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            url: error.config?.url,
            method: error.config?.method
        });
        return {
            success: false,
            error: error.response?.data || error.message,
            status: error.response?.status
        };
    }
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
                }, {
                    responseType: 'arraybuffer',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' }
                });

                const responseText = Buffer.from(response.data).toString('utf8');
                const responseData = JSON.parse(responseText);

                resolve(responseData);
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
        db.all("SELECT * FROM users ORDER BY entry_at DESC, created_at DESC", [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
});

ipcMain.handle('db:addUser', (event, user) => {
    return new Promise((resolve, reject) => {
        const {
            id, name, email, role, area, status, photo,
            customer_id, order_detail_id, order_id, order_turnstile_id,
            entry_dates, entry_period,
            start_date, entry_at, expired_date_in, expired_date_out
        } = user;

        db.run(
            `INSERT INTO users (
                id, name, email, role, area, status, photo, 
                customer_id, order_detail_id, order_id, order_turnstile_id,
                entry_dates, entry_period,
                start_date, entry_at, expired_date_in, expired_date_out, is_latest
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                id, name, email, role, area, status, photo,
                customer_id, order_detail_id, order_id, order_turnstile_id,
                entry_dates, entry_period,
                start_date, entry_at || start_date, expired_date_in, expired_date_out
            ],
            function (err) {
                if (err) reject(err);
                resolve({ record_id: this.lastID, id: id });
            }
        );
    });
});

ipcMain.handle('db:deleteUser', (event, recordId) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT photo FROM users WHERE record_id = ?", [recordId], (err, user) => {
            if (err) return reject(err);

            db.run(`DELETE FROM users WHERE record_id = ?`, [recordId], function (err) {
                if (err) return reject(err);

                if (user && user.photo) {
                    deletePhotoFile(user.photo);
                }

                resolve({ changes: this.changes });
            });
        });
    });
});

ipcMain.handle('db:bulkDeleteUsers', (event, recordIds) => {
    return new Promise((resolve, reject) => {
        if (!Array.isArray(recordIds) || recordIds.length === 0) {
            return resolve({ changes: 0 });
        }

        const placeholders = recordIds.map(() => '?').join(',');
        db.all(`SELECT photo FROM users WHERE record_id IN (${placeholders})`, recordIds, (err, rows) => {
            if (err) return reject(err);

            db.run(`DELETE FROM users WHERE record_id IN (${placeholders})`, recordIds, function (err) {
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
        db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value], function (err) {
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
            [name, description, accessLevel], function (err) {
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
            [name, description, accessLevel, id], function (err) {
                if (err) reject(err);
                resolve({ changes: this.changes });
            }
        );
    });
});

ipcMain.handle('db:deleteArea', (event, id) => {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM areas WHERE id = ?`, [id], function (err) {
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
            [name, ip, area, status, lastSeen], function (err) {
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
            [name, ip, area, status, lastSeen, id], function (err) {
                if (err) reject(err);
                resolve({ changes: this.changes });
            }
        );
    });
});

ipcMain.handle('db:deleteDevice', (event, id) => {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM devices WHERE id = ?`, [id], function (err) {
            if (err) reject(err);
            resolve({ changes: this.changes });
        });
    });
});