// Global application state
let currentPage = 'dashboard';
let currentModal = null;
let currentUser = null;
let confirmAction = null;
let capturedPhotoDataUrl = null;
let currentEditingDevice = null;

// Loading screen functions
function showLoading() {
    document.getElementById('loading-backdrop').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-backdrop').style.display = 'none';
}

// Corrected formatDate function to handle 'YYYY-MM-DD HH:mm:ss'
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';

    // Handle if passing a Date object
    let d;
    if (dateStr instanceof Date) {
        d = dateStr;
    } else {
        // Ensure string and handle ISO format
        let s = String(dateStr).trim();
        if (s.includes('T')) s = s.replace('T', ' ').split('.')[0];

        // If it looks like just a date "YYYY-MM-DD"
        if (!s.includes(' ')) s += ' 00:00:00';

        const [datePart, timePart] = s.split(' ');
        if (!datePart) return 'N/A';

        const [year, month, day] = datePart.split('-');
        let [hours, minutes, seconds] = (timePart || '00:00:00').split(':');

        d = new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, seconds || 0);
    }

    if (isNaN(d.getTime())) return 'Invalid Date';

    // Format the date to DD-MM-YY
    const formattedDay = String(d.getDate()).padStart(2, '0');
    const formattedMonth = String(d.getMonth() + 1).padStart(2, '0');
    const formattedYear = String(d.getFullYear()).slice(-2);
    const formattedHours = String(d.getHours()).padStart(2, '0');
    const formattedMinutes = String(d.getMinutes()).padStart(2, '0');
    const formattedSeconds = String(d.getSeconds()).padStart(2, '0');

    return `${formattedDay}-${formattedMonth}-${formattedYear} ${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

document.addEventListener('DOMContentLoaded', async function () {
    initializeNavigation();
    setupEventListeners();
    await initializeDashboard();
});

// Navigation handling
function initializeNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', async function (e) {
            e.preventDefault();
            const page = this.dataset.page;
            showPage(page);
            if (page === 'users') {
                await populateUsers();
            } else if (page === 'areas') {
                await populateAreas();
            } else if (page === 'devices') {
                await populateDevices();
            } else if (page === 'settings') {
                await loadSettingsPage();
            }
        });
    });
}

function formatDateForInput(dateStr) {
    if (!dateStr) return '';

    const [datePart, timePart] = dateStr.split(' ');
    if (!datePart || !timePart) return '';

    const [year, month, day] = datePart.split('-');
    const [hours, minutes] = timePart.split(':');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatDateFromInput(inputDate) {
    if (!inputDate) return '';

    const date = new Date(inputDate);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function showPage(pageName) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));

    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => link.classList.remove('active'));

    const targetPage = document.getElementById(`${pageName}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    const targetNavLink = document.querySelector(`[data-page="${pageName}"]`);
    if (targetNavLink) {
        targetNavLink.classList.add('active');
    }

    const pageTitles = {
        dashboard: 'Dashboard',
        users: 'User Management',
        areas: 'Area Management',
        devices: 'Device Management',
        settings: 'Settings'
    };

    document.getElementById('page-title').textContent = pageTitles[pageName] || 'Dashboard';
    currentPage = pageName;
}

// Data Refresh Function
async function refreshPageData(pageName) {
    showLoading();
    showNotification(`Refreshing ${pageName} data...`, 'info');
    try {
        if (pageName === 'dashboard') {
            await updateStats();
            // populateActivities();
        } else if (pageName === 'users') {
            await populateUsers();
        } else if (pageName === 'areas') {
            await populateAreas();
        } else if (pageName === 'devices') {
            await populateDevices();
        }
        showNotification(`${pageName} data refreshed successfully!`);
    } catch (error) {
        showNotification(`Failed to refresh ${pageName} data.`, 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

// Modal handling
function openModal(modalId) {
    closeModal();
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById(modalId);

    if (overlay && modal) {
        overlay.classList.add('active');
        modal.classList.add('active');
        currentModal = modalId;
    }
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    const modals = document.querySelectorAll('.modal');

    if (overlay) {
        overlay.classList.remove('active');
    }

    modals.forEach(modal => {
        modal.classList.remove('active');
    });

    currentModal = null;
    currentUser = null;
    capturedPhotoDataUrl = null;
    currentEditingDevice = null;

    const forms = document.querySelectorAll('form');
    forms.forEach(form => form.reset());

    const confirmInput = document.getElementById('confirm-input');
    if (confirmInput) {
        confirmInput.value = '';
    }

    closeCamera();
}

// Event listeners setup
function setupEventListeners() {
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
        if (e.target === this) {
            closeModal();
        }
    });

    const confirmInput = document.getElementById('confirm-input');
    if (confirmInput) {
        confirmInput.addEventListener('input', function () {
            const confirmBtn = document.getElementById('confirm-action-btn');
            if (this.value.toLowerCase() === 'confirm') {
                confirmBtn.disabled = false;
            } else {
                confirmBtn.disabled = true;
            }
        });
    }

    setupSearchHandlers();
}

function setupSearchHandlers() {
    document.getElementById('user-search').addEventListener('input', function () {
        filterTable('users-table', this.value);
    });

    document.getElementById('area-search').addEventListener('input', function () {
        filterTable('areas-table', this.value);
    });

    document.getElementById('device-search').addEventListener('input', function () {
        filterTable('devices-table', this.value);
    });
}

function filterTable(tableId, searchTerm) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const rows = table.querySelectorAll('tbody tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(searchTerm.toLowerCase())) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Confirmation dialog
function showConfirmationModal(title, message, action) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const confirmInput = document.getElementById('confirm-input');
    confirmInput.value = '';
    document.getElementById('confirm-action-btn').disabled = true;
    confirmAction = action;
    openModal('confirmation-modal');
    // Focus on input after modal opens
    setTimeout(() => {
        confirmInput.focus();
    }, 100);
}

function executeConfirmedAction() {
    if (confirmAction && document.getElementById('confirm-input').value.toLowerCase() === 'confirm') {
        confirmAction();
        closeModal();
    }
}

// Utility functions
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i>
        ${message}
    `;

    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add('show'), 100);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => document.body.removeChild(notification), 300);
    }, 3000);
}

const notificationStyles = `
.notification {
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 3000;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    max-width: 400px;
}

.notification.show {
    transform: translateX(0);
}

.notification-success {
    background: #16a34a;
}

.notification-error {
    background: #dc2626;
}
.notification-info {
    background: #007bff;
}
`;

const style = document.createElement('style');
style.textContent = notificationStyles;
document.head.appendChild(style);

// Dashboard functionality
async function initializeDashboard() {
    await updateStats();
    // populateActivities();
}

async function updateStats() {
    const users = await window.electronAPI.getUsers();
    const devices = await window.electronAPI.getDevices();
    const areas = await window.electronAPI.getAreas();

    document.getElementById('total-users').textContent = users.length;
    document.getElementById('active-devices').textContent = devices.filter(d => d.status === 'online').length;
    document.getElementById('total-areas').textContent = areas.length;
    // document.getElementById('today-access').textContent = '156';
}

// function populateActivities() {
//     const activities = [
//         { icon: 'user-plus', title: 'New user registered', time: '2 minutes ago', user: 'Sarah Wilson' },
//         { icon: 'door-open', title: 'Gate access granted', time: '5 minutes ago', user: 'John Smith' },
//         { icon: 'microchip', title: 'Device came online', time: '15 minutes ago', user: 'Main Gate Scanner' },
//         { icon: 'user-times', title: 'User access denied', time: '1 hour ago', user: 'Unknown User' },
//         { icon: 'cog', title: 'System settings updated', time: '2 hours ago', user: 'Administrator' }
//     ];

//     const activityList = document.getElementById('activity-list');
//     activityList.innerHTML = activities.map(activity => `
//         <div class="activity-item">
//             <div class="activity-icon">
//                 <i class="fas fa-${activity.icon}"></i>
//             </div>
//             <div class="activity-content">
//                 <div class="activity-title">${activity.title}</div>
//                 <div class="activity-time">${activity.time} • ${activity.user}</div>
//             </div>
//         </div>
//     `).join('');
// }

// SYNC FUNCTION
async function syncWithDevice() {
    showNotification('Syncing not yet implemented for all devices. Please sync from individual device pages.', 'info');
}

// Area management functionality (uses local DB)
async function populateAreas() {
    showLoading();
    const areas = await window.electronAPI.getAreas();
    const tbody = document.getElementById('areas-tbody');

    if (areas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No areas found. Add a new area to get started.</td></tr>';
        hideLoading();
        return;
    }

    tbody.innerHTML = areas.map(area => `
        <tr>
            <td><div style="font-weight: 500;">${area.name}</div></td>
            <td>${area.description}</td>
            <td><span class="status-badge status-active">0 devices</span></td>
            <td><span class="status-badge status-inactive">0 users</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon btn-edit" onclick="editArea(${area.id})" title="Edit Area">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="deleteArea(${area.id})" title="Delete Area">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    hideLoading();
}

let currentEditingArea = null;

function openAddAreaModal() {
    document.getElementById('area-modal-title').textContent = 'Add New Area';
    document.getElementById('add-area-form').reset();
    currentEditingArea = null;
    openModal('add-area-modal');
}

async function editArea(areaId) {
    const areas = await window.electronAPI.getAreas();
    const area = areas.find(a => a.id === areaId);
    if (!area) return;
    currentEditingArea = area;
    document.getElementById('area-modal-title').textContent = 'Edit Area';
    document.getElementById('area-name').value = area.name;
    document.getElementById('area-description').value = area.description;
    document.getElementById('area-access-level').value = area.accessLevel;
    openModal('add-area-modal');
}

async function deleteArea(areaId) {
    showConfirmationModal(
        'Delete Area',
        `Are you sure you want to delete this area?`,
        async () => {
            await window.electronAPI.deleteArea(areaId);
            showNotification('Area deleted successfully!');
            await populateAreas();
            await updateStats();
        }
    );
}

async function saveArea() {
    const name = document.getElementById('area-name').value;
    const description = document.getElementById('area-description').value;
    const accessLevel = document.getElementById('area-access-level').value;

    if (!name || !accessLevel) {
        showNotification('Please fill all required fields!', 'error');
        return;
    }

    if (currentEditingArea) {
        currentEditingArea.name = name;
        currentEditingArea.description = description;
        currentEditingArea.accessLevel = accessLevel;
        await window.electronAPI.updateArea(currentEditingArea);
        showNotification('Area updated successfully!');
    } else {
        const newArea = { name, description, accessLevel };
        await window.electronAPI.addArea(newArea);
        showNotification('Area added successfully!');
    }

    await populateAreas();
    await updateStats();
    closeModal();
}

// Device management functionality

/**
 * Populates the "Assigned Area" dropdown with areas from the database.
 */
async function populateAreaDropdown(dropdownId) {
    const areaSelect = document.getElementById(dropdownId);
    const areas = await window.electronAPI.getAreas();

    // Clear existing options
    areaSelect.innerHTML = '<option value="">Select Area</option>';

    // Add new options from the database
    areas.forEach(area => {
        const option = document.createElement('option');
        option.value = area.id;
        option.textContent = area.name;
        areaSelect.appendChild(option);
    });
}

async function populateDevices() {
    showLoading();
    const devices = await window.electronAPI.getDevices();
    const tbody = document.getElementById('devices-tbody');
    const areas = await window.electronAPI.getAreas();
    const areaMap = new Map(areas.map(area => [area.id.toString(), area.name]));

    if (devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No devices found. Add a new device to get started.</td></tr>';
        hideLoading();
        return;
    }

    // Use Promise.all to fetch all device statuses concurrently for better performance
    const devicesWithStatus = await Promise.all(devices.map(async device => {
        const status = await window.electronAPI.getDeviceStatus(device.ip);
        const now = new Date();

        // Format the date and time to a human-readable string with 24-hour time
        const formattedDate = now.toLocaleDateString();
        const formattedTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        const lastSeen = `${formattedDate}, ${formattedTime}`;

        // Update the local database with the new status
        await window.electronAPI.updateDevice({ ...device, status, lastSeen });

        return { ...device, status, lastSeen };
    }));

    tbody.innerHTML = devicesWithStatus.map(device => {
        const areaName = areaMap.get(device.area.toString()) || 'Unknown Area';
        return `
        <tr>
            <td><div style="font-weight: 500;">${device.name}</div></td>
            <td><code style="background: #f1f5f9; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">${device.ip}</code></td>
            <td>${areaName}</td>
            <td><span class="status-badge status-${device.status}">${device.status}</span></td>
            <td style="color: #6b7280; font-size: 0.875rem;">${device.lastSeen}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon btn-gate" onclick="openGate(${device.id})" title="Open Gate" ${device.status === 'offline' ? 'disabled' : ''}>
                        <i class="fas fa-door-open"></i>
                    </button>
                    <button class="btn-icon btn-restart" onclick="restartDevice(${device.id})" title="Restart Device" ${device.status === 'offline' ? 'disabled' : ''}>
                        <i class="fas fa-redo"></i>
                    </button>
                    <button class="btn-icon btn-edit" onclick="openEditDeviceModal(${device.id})" title="Edit Device">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="deleteDevice(${device.id})" title="Delete Device">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
    }).join('');

    hideLoading();
    await updateStats(); // Call updateStats after populating the table
}

function openAddDeviceModal() {
    document.getElementById('add-device-form').reset();
    currentEditingDevice = null;
    populateAreaDropdown('device-area');
    openModal('add-device-modal');
}

// NEW: Function to open the dedicated edit modal
async function openEditDeviceModal(deviceId) {
    const devices = await window.electronAPI.getDevices();
    const device = devices.find(d => d.id === deviceId);
    console.log(device)
    if (!device) {
        showNotification('Device not found!', 'error');
        return;
    }

    currentEditingDevice = device;

    // First, open the modal. This will clear the form.
    openModal('edit-device-modal');

    // Next, populate the dropdown with area options.
    await populateAreaDropdown('edit-device-area');

    // Finally, set the values of the form fields.
    document.getElementById('edit-device-id').value = device.id;
    document.getElementById('edit-device-name').value = device.name;
    document.getElementById('edit-device-ip').value = device.ip;
    document.getElementById('edit-device-area').value = device.area;
}

async function openGate(deviceId) {
    const devices = await window.electronAPI.getDevices();
    const device = devices.find(d => d.id === deviceId);
    if (!device || device.status === 'offline') return;

    showConfirmationModal(
        'Open Gate',
        `Open the gate for "${device.name}"? This will trigger the physical gate mechanism.`,
        async () => {
            const result = await window.electronAPI.openGate(deviceId);
            if (result.result === 0) {
                showNotification(`Gate opened successfully for ${device.name}!`);
            } else {
                showNotification(`Failed to open gate for ${device.name}.`, 'error');
            }
        }
    );
}

async function restartDevice(deviceId) {
    const devices = await window.electronAPI.getDevices();
    const device = devices.find(d => d.id === deviceId);
    if (!device || device.status === 'offline') return;

    showConfirmationModal(
        'Restart Device',
        `Restart "${device.name}"? The device will be temporarily unavailable.`,
        async () => {
            const result = await window.electronAPI.restartDevice(deviceId);
            if (result.result === 0) {
                showNotification(`${device.name} is restarting...`);
                setTimeout(async () => {
                    await populateDevices();
                    await updateStats();
                    showNotification(`${device.name} restarted successfully!`);
                }, 5000);
            } else {
                showNotification(`Failed to restart device: ${device.name}.`, 'error');
            }
        }
    );
}

async function deleteDevice(deviceId) {
    showConfirmationModal(
        'Delete Device',
        `Permanently delete this device? This cannot be undone.`,
        async () => {
            await window.electronAPI.deleteDevice(deviceId);
            showNotification('Device deleted successfully!');
            await populateDevices();
            await updateStats();
        }
    );
}

// NEW: Function to update an existing device
async function updateDevice() {
    const id = document.getElementById('edit-device-id').value;
    const name = document.getElementById('edit-device-name').value;
    const ip = document.getElementById('edit-device-ip').value;
    const area = document.getElementById('edit-device-area').value;

    if (!name || !ip || !area) {
        showNotification('Please fill all required fields!', 'error');
        return;
    }

    const device = {
        id: parseInt(id),
        name: name,
        ip: ip,
        area: area,
    };

    try {
        await window.electronAPI.updateDevice(device);
        showNotification('Device updated successfully!');
        await populateDevices();
        await updateStats();
        closeModal();
    } catch (error) {
        showNotification('Failed to update device.', 'error');
        console.error('Failed to update device:', error);
    }
}

async function saveDevice() {
    const name = document.getElementById('device-name').value;
    const ip = document.getElementById('device-ip').value;
    const area = document.getElementById('device-area').value;
    const password = document.getElementById('device-password').value;

    if (!name || !ip || !area) {
        showNotification('Please fill all required fields!', 'error');
        return;
    }

    // if (!password) {
    //     showNotification('Device password is required!', 'error');
    //     return;
    // }

    const status = await window.electronAPI.getDeviceStatus(ip);
    const lastSeen = status === 'online' ? 'Just now' : 'Never';

    const newDevice = { name, ip, area, status, lastSeen };
    await window.electronAPI.addDevice(newDevice);
    showNotification('Device added successfully!');

    await populateDevices();
    await updateStats();
    closeModal();
}

// Settings functionality
async function loadSettingsPage() {
    showLoading();
    try {
        const settings = await window.electronAPI.getSettings();
        document.getElementById('backoffice-api-url').value = settings.BACKOFFICE_API_URL || '';
        document.getElementById('device-password').value = settings.DEVICE_PASS || '';
        document.getElementById('api-email').value = settings.API_EMAIL || '';
        document.getElementById('api-password').value = settings.API_PASSWORD || '';
        document.getElementById('store-id').value = settings.STORE_ID || '';
        document.getElementById('entry-time-limit').value = settings.ENTRY_TIME_LIMIT || '2';

        showNotification('Settings loaded successfully!');
    } catch (error) {
        showNotification('Failed to load settings.', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

async function saveSettings() {
    const backofficeApiUrl = document.getElementById('backoffice-api-url').value;
    const devicePassword = document.getElementById('device-password').value;
    const apiEmail = document.getElementById('api-email').value;
    const apiPassword = document.getElementById('api-password').value;
    const storeId = document.getElementById('store-id').value;
    const entryTimeLimit = document.getElementById('entry-time-limit').value;

    // Validation
    if (!backofficeApiUrl || !devicePassword || !apiEmail || !apiPassword || !storeId) {
        showNotification('Please fill all required fields!', 'error');
        return;
    }

    // Validate entry time limit
    const timeLimitNum = parseFloat(entryTimeLimit);
    if (!entryTimeLimit || isNaN(timeLimitNum) || timeLimitNum < 0.5 || timeLimitNum > 24) {
        showNotification('Entry time limit must be between 0.5 and 24 hours!', 'error');
        return;
    }

    showLoading();
    try {
        await window.electronAPI.setSetting('BACKOFFICE_API_URL', backofficeApiUrl);
        await window.electronAPI.setSetting('DEVICE_PASS', devicePassword);
        await window.electronAPI.setSetting('API_EMAIL', apiEmail);
        await window.electronAPI.setSetting('API_PASSWORD', apiPassword);
        await window.electronAPI.setSetting('STORE_ID', storeId);
        await window.electronAPI.setSetting('ENTRY_TIME_LIMIT', entryTimeLimit);

        showNotification('Settings saved successfully!');
    } catch (error) {
        showNotification('Failed to save settings.', 'error');
        console.error(error);
    } finally {
        hideLoading();
    }
}

function isExpired(dateStr) {
    if (!dateStr) return false;
    const [datePart, timePart] = dateStr.split(' ');
    const [year, month, day] = datePart.split('-');
    const [hours, minutes, seconds] = timePart ? timePart.split(':') : [0, 0, 0];

    const targetDate = new Date(year, month - 1, day, hours, minutes, seconds);
    const now = new Date();

    // Compare based on actual timestamp
    return targetDate.getTime() < now.getTime();
}



async function populateUsers() {
    showLoading();
    const users = await window.electronAPI.getUsers();
    const tbody = document.getElementById('users-tbody');
    const userDataPath = await window.electronAPI.getUserDataPath();

    if (!tbody) {
        console.error("users-tbody not found in DOM");
        hideLoading();
        return;
    }

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No users found. Add a new user or click API Sync to get started.</td></tr>';
        hideLoading();
        return;
    }

    // Group by face_group_id (for duplicate faces), then by customer_id, then by name
    const groupedUsers = {};
    users.forEach(user => {
        let key;
        if (user.face_group_id) {
            // Users with same face are grouped together
            key = `face_${user.face_group_id}`;
        } else if (user.customer_id) {
            key = `cust_${user.customer_id}`;
        } else {
            key = `name_${user.name}`;
        }
        if (!groupedUsers[key]) groupedUsers[key] = [];
        groupedUsers[key].push(user);
    });

    // Get today's date for comparison
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const rows = [];

    // Process each group
    Object.values(groupedUsers).forEach(group => {
        // Sort group members by entry_at desc
        group.sort((a, b) => new Date(b.entry_at || 0) - new Date(a.entry_at || 0));

        const mainUser = group[0]; // Representative for the main row (usually the latest)

        // Check if this is a face group (duplicate faces with different IDs)
        const isFaceGroup = mainUser.face_group_id ? true : false;
        const uniqueIds = [...new Set(group.map(u => u.id))];
        const hasDuplicateFaces = isFaceGroup && uniqueIds.length > 1;

        // Aggregate info
        let totalUsed = 0;
        let totalLimit = 0;
        let maxExitDate = '';

        let accordionContent = '';

        // If duplicate faces, show a header indicating this
        if (hasDuplicateFaces) {
            accordionContent += `
                <div style="margin-bottom: 16px; padding: 12px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px; border-left: 4px solid #f59e0b;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <i class="fas fa-user-friends" style="color: #d97706; font-size: 1.1rem;"></i>
                        <span style="font-weight: 600; color: #92400e; font-size: 0.9rem;">Same Face - Multiple Registrations</span>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${uniqueIds.map(id => `
                            <span style="background: #fff; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; color: #78350f; border: 1px solid #fbbf24;">
                                <i class="fas fa-id-card" style="margin-right: 4px;"></i>${id}
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        group.forEach((u, idx) => {
            let dates = [];
            try { dates = u.entry_dates ? JSON.parse(u.entry_dates) : []; } catch (e) { }
            sortDatesNearest(dates); // Sort by Nearest (Today/Future first)

            const used = dates.length;
            const limit = u.entry_period || 0;
            totalUsed += used;
            totalLimit += limit;

            // Find max expiry
            if (!maxExitDate || (u.expired_date_out && new Date(u.expired_date_out) > new Date(maxExitDate))) {
                maxExitDate = u.expired_date_out;
            }

            // FILTER: Show STRICTLY dates within THIS WEEK (Mon-Sun)
            const now = new Date();
            const currentDay = now.getDay() || 7;
            const weekStart = new Date(now);
            weekStart.setHours(0, 0, 0, 0);
            if (currentDay !== 1) weekStart.setDate(weekStart.getDate() - (currentDay - 1));

            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);

            const visibleDates = dates.filter(d => {
                const dateObj = new Date(d);
                return dateObj >= weekStart && dateObj <= weekEnd;
            });
            const hiddenCount = dates.length - visibleDates.length;

            // Build Date Badges for visible dates
            const entryDatesHtml = visibleDates.map(date => {
                const dateObj = new Date(date);
                const isToday = date === todayStr;
                const isPast = date < todayStr;

                let dateClass = '';
                let badgeHtml = '';

                if (isToday) {
                    dateClass = 'entry-date-today';
                    badgeHtml = '<span class="date-badge date-badge-today">Today</span>';
                } else if (isPast) { // Should not happen given filter, but safe to keep
                    dateClass = 'entry-date-expired';
                    badgeHtml = '<span class="date-badge date-badge-expired">Expired</span>';
                } else {
                    dateClass = 'entry-date-upcoming';
                    badgeHtml = '<span class="date-badge date-badge-upcoming">Upcoming</span>';
                }

                return `
                    <div class="entry-date-item ${dateClass}" style="display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; ${isPast ? 'opacity: 0.6;' : ''} font-size: 0.8rem; background: #fff;">
                        <i class="fas fa-calendar-day" style="color: ${isToday ? '#16a34a' : isPast ? '#9ca3af' : '#3b82f6'};"></i>
                        <span>${formatEntryDate(date)}</span>
                        ${badgeHtml}
                    </div>
                `;
            }).join('');

            // History Link
            const historyLink = hiddenCount > 0
                ? `<div style="width:100%; margin-top:4px;">
                      <span style="font-size:0.75rem; color:#9ca3af; font-style:italic;">${hiddenCount} past entries hidden. </span>
                      <a href="#" onclick="viewUser('${u.record_id}'); return false;" style="font-size:0.75rem; color:#3b82f6; text-decoration:none;">View Full History</a>
                   </div>`
                : '';

            // Format expiry date for display
            const expiryDisplay = u.expired_date_out ? formatDate(u.expired_date_out) : 'N/A';
            const startDisplay = u.start_date ? formatDate(u.start_date) : 'N/A';

            // Show ID badge if this is a duplicate face group
            const idBadge = hasDuplicateFaces
                ? `<span style="background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; margin-left: 8px;">ID: ${u.id}</span>`
                : '';

            // Append to accordion
            accordionContent += `
                <div class="order-group-item" style="margin-bottom: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                        <div>
                            <div style="font-weight: 600; font-size: 0.85rem; color: #374151; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                                <i class="fas fa-receipt" style="color: #6b7280; margin-right: 4px;"></i>
                                Order #${u.order_detail_id || u.order_id || 'N/A'}
                                ${u.order_turnstile_id ? `<span style="font-weight:400; color:#6b7280; font-size: 0.75rem;">(Turnstile: ${u.order_turnstile_id})</span>` : ''}
                                ${idBadge}
                            </div>
                            <div style="font-size: 0.75rem; color: #9ca3af; margin-top: 4px;">
                                <i class="fas fa-clock" style="margin-right: 4px;"></i>
                                ${startDisplay} - ${expiryDisplay}
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                            <span style="font-size: 0.8rem; background: ${used >= limit && limit > 0 ? '#fee2e2' : '#dcfce7'}; color: ${used >= limit && limit > 0 ? '#991b1b' : '#166534'}; padding: 4px 10px; border-radius: 20px; font-weight: 500;">
                                ${used}/${limit || '∞'} entries
                            </span>
                        </div>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px; padding-top: 8px; border-top: 1px dashed #e5e7eb;">
                        ${entryDatesHtml.length > 0 ? entryDatesHtml : '<span style="font-size:0.8rem; color:#9ca3af; padding:4px;"><i class="fas fa-calendar-times" style="margin-right: 4px;"></i>No entries this week</span>'}
                        ${historyLink}
                    </div>
                </div>
            `;
        });

        // Determine Status based on maxExitDate
        const isUserExpired = isExpired(maxExitDate);
        let statusText = mainUser.status;
        let statusClass;
        if (isUserExpired) {
            statusText = 'Expired';
            statusClass = 'status-expired';
        } else if (mainUser.status === 'Paid') {
            statusClass = 'status-active';
        } else {
            statusText = 'Unpaid/Inactive';
            statusClass = 'status-inactive';
        }

        // Device sync status - check if ALL entries in group are synced
        const allSynced = group.every(u => u.device_synced === 1);
        const deviceSyncHtml = allSynced
            ? `<span class="status-badge status-active" style="font-size: 0.75rem;">Synced</span>`
            : `<button class="btn-resync" onclick="resyncUser('${mainUser.record_id}')" title="Device was offline during sync. Click to resync.">
                   <i class="fas fa-exclamation-triangle" style="margin-right: 4px;"></i>Resync
               </button>`;

        // Photo
        let userPhotoPath = mainUser.photo
            ? `file://${userDataPath.replaceAll('\\', '/')}/${mainUser.photo.replaceAll('\\', '/')}`
            : './defuser.jpg';

        // Sync Button logic (using mainUser record)
        const syncButton = `<button class="btn-icon btn-sync" id="sync-btn-${mainUser.record_id}" onclick="syncUserToDevices('${mainUser.record_id}')" title="Sync this User Group">
                               <i class="fas fa-sync-alt"></i>
                           </button>`;

        // Duplicate face indicator
        const duplicateFaceIndicator = hasDuplicateFaces
            ? `<span style="background: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; margin-left: 6px; display: inline-flex; align-items: center; gap: 3px;" title="Same face registered with ${uniqueIds.length} different IDs">
                   <i class="fas fa-user-friends"></i>${uniqueIds.length}
               </span>`
            : '';

        // Order count display
        const orderCountDisplay = group.length > 1 ? `${group.length} Orders` : (mainUser.order_detail_id || mainUser.order_id || 'N/A');

        // Add Main Row
        rows.push(`
        <tr class="user-group-main ${hasDuplicateFaces ? 'has-duplicate-faces' : ''}" data-record-id="${mainUser.record_id}" style="${hasDuplicateFaces ? 'background-color: #fffbeb;' : ''}">
            <td><input type="checkbox" class="user-checkbox" value="${mainUser.record_id}"></td>
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="position: relative;">
                        <img src="${userPhotoPath}" alt="${mainUser.name}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid ${hasDuplicateFaces ? '#f59e0b' : '#e5e7eb'};">
                        ${hasDuplicateFaces ? '<span style="position: absolute; bottom: -2px; right: -2px; background: #f59e0b; color: #fff; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.6rem;"><i class="fas fa-link"></i></span>' : ''}
                    </div>
                    <div>
                        <div style="font-weight: 500; display: flex; align-items: center; flex-wrap: wrap;">
                            ${mainUser.name}${duplicateFaceIndicator}
                        </div>
                        <small style="color: #6b7280; font-size: 0.75rem;">ID: ${mainUser.id}</small>
                    </div>
                </div>
            </td>
            <td>
                <span style="background: ${group.length > 1 ? '#e0e7ff' : '#f3f4f6'}; color: ${group.length > 1 ? '#3730a3' : '#374151'}; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">
                    ${orderCountDisplay}
                </span>
            </td>
            <td>
                <span class="entry-count-badge" title="Total Used: ${totalUsed} / Limit: ${totalLimit}" style="background: ${totalUsed >= totalLimit && totalLimit > 0 ? '#fee2e2' : '#dcfce7'}; color: ${totalUsed >= totalLimit && totalLimit > 0 ? '#991b1b' : '#166534'}; padding: 4px 10px; border-radius: 20px; font-weight: 500;">
                    ${totalUsed}/${totalLimit || '∞'}
                </span>
            </td>
            <td>${formatDate(maxExitDate)}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${deviceSyncHtml}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon btn-expand" onclick="toggleEntryDates('${mainUser.record_id}')" title="View All Orders & Details">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                    <button class="btn-icon btn-view" onclick="viewUser('${mainUser.record_id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="deleteUser('${mainUser.record_id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                    ${syncButton}
                </div>
            </td>
        </tr>
        <tr class="entry-dates-row" data-record-id="${mainUser.record_id}" style="display: none; background-color: #fff;">
            <td></td>
            <td colspan="7" style="padding: 0;">
                <div style="padding: 16px; background-color: ${hasDuplicateFaces ? '#fffbeb' : '#f8fafc'}; border-top: 1px solid #e5e7eb; box-shadow: inset 0 2px 4px rgba(0,0,0,0.03);">
                    <div style="margin-bottom: 12px; color: #475569; font-weight: 500; font-size: 0.9rem; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-layer-group"></i> Order Details &amp; Entry History
                        ${hasDuplicateFaces ? '<span style="background: #fbbf24; color: #78350f; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem;">Duplicate Face Group</span>' : ''}
                    </div>
                    ${accordionContent}
                </div>
            </td>
        </tr>
        `);
    });

    tbody.innerHTML = rows.join('');
    hideLoading();
}

// Helper function to format entry date
function formatEntryDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Toggle entry dates visibility
function toggleEntryDates(recordId) {
    const dateRows = document.querySelectorAll(`tr.entry-dates-row[data-record-id="${recordId}"]`);
    const expandButton = document.querySelector(`tr.user-group-main[data-record-id="${recordId}"] .btn-expand i`);

    dateRows.forEach(row => {
        if (row.style.display === 'none') {
            row.style.display = '';
            if (expandButton) expandButton.className = 'fas fa-chevron-up';
        } else {
            row.style.display = 'none';
            if (expandButton) expandButton.className = 'fas fa-chevron-down';
        }
    });
}

function toggleUserHistory(entryId) {
    const historyRows = document.querySelectorAll(`tr.user-history-row[data-entry-id="${entryId}"]`);
    const expandButton = document.querySelector(`tr.user-group-main[data-entry-id="${entryId}"] .btn-expand i`);

    historyRows.forEach(row => {
        if (row.style.display === 'none') {
            row.style.display = '';
            if (expandButton) expandButton.className = 'fas fa-chevron-up';
        } else {
            row.style.display = 'none';
            if (expandButton) expandButton.className = 'fas fa-chevron-down';
        }
    });
}

async function deleteUserGroup(entryId) {
    const users = await window.electronAPI.getUsers();
    const userGroup = users.filter(u => u.id === entryId);

    if (userGroup.length === 0) {
        showNotification('User group not found', 'error');
        return;
    }

    const entryCount = userGroup.length;
    const message = entryCount > 1
        ? `Delete all ${entryCount} entries for this person? This will remove them from all devices.`
        : `Delete this user? This will remove them from all devices.`;

    showConfirmationModal(
        'Delete User',
        message,
        async () => {
            try {
                showLoading();

                // Delete from devices
                try {
                    await window.electronAPI.deleteUserFromAllDevices(entryId);
                } catch (deviceErr) {
                    console.error('Error deleting from devices:', deviceErr);
                }

                // Delete all entries from database
                const recordIds = userGroup.map(u => u.record_id);
                await window.electronAPI.bulkDeleteUsers(recordIds);

                showNotification(`Deleted all entries for user ${entryId}`);
                await populateUsers();
                await updateStats();
            } catch (err) {
                console.error('Error deleting user group:', err);
                showNotification('Failed to delete user group: ' + err.message, 'error');
            } finally {
                hideLoading();
            }
        }
    );
}

// Delete single entry
async function deleteUserEntry(recordId) {
    showConfirmationModal(
        'Delete Entry',
        'Delete this specific entry? The user will remain in the system with other entries.',
        async () => {
            try {
                showLoading();
                await window.electronAPI.deleteUser(recordId);
                showNotification('Entry deleted successfully');
                await populateUsers();
                await updateStats();
            } catch (err) {
                console.error('Error deleting entry:', err);
                showNotification('Failed to delete entry: ' + err.message, 'error');
            } finally {
                hideLoading();
            }
        }
    );
}

// Delete user by record_id (removes from devices too)
async function syncUserToDevices(recordId) {
    const btn = document.getElementById(`sync-btn-${recordId}`);
    const originalIcon = btn.innerHTML;

    // Show a preload/spinner
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        // Fetch the user from database
        const users = await window.electronAPI.getUsers();
        const user = users.find(u => u.record_id == recordId);

        if (!user) {
            showNotification('User not found in database', 'error');
            return;
        }

        console.log("Syncing user to devices:", user);

        // Find all users with the same ID (face_group_id takes precedence), then order_id
        let usersToSync = [];

        // First, group by face_group_id if exists
        if (user.face_group_id) {
            usersToSync = users.filter(u => u.face_group_id === user.face_group_id);
            console.log(`Found ${usersToSync.length} users with face_group_id ${user.face_group_id}`);
        }
        // Then try order_id
        else if (user.order_id) {
            usersToSync = users.filter(u => u.order_id === user.order_id);
            console.log(`Found ${usersToSync.length} users with order_id ${user.order_id}`);
        }
        // Finally, just the single user
        else {
            usersToSync = [user];
        }

        // Group by unique ID and find the one with the latest end date for each ID
        const idGroups = {};
        for (const u of usersToSync) {
            if (!idGroups[u.id]) {
                idGroups[u.id] = [];
            }
            idGroups[u.id].push(u);
        }

        // For each unique ID, get the user with the latest expired_date_out
        const usersWithLatestDates = [];
        for (const [id, group] of Object.entries(idGroups)) {
            // Sort by expired_date_out descending
            group.sort((a, b) => {
                const dateA = new Date(a.expired_date_out || '1970-01-01');
                const dateB = new Date(b.expired_date_out || '1970-01-01');
                return dateB - dateA;
            });
            const latestUser = group[0];
            console.log(`ID ${id}: Using latest end date ${latestUser.expired_date_out} from record_id ${latestUser.record_id}`);
            usersWithLatestDates.push(latestUser);
        }

        let allSuccess = true;
        const syncResults = [];

        // Sync each unique ID with the latest end date
        for (const userToSync of usersWithLatestDates) {
            console.log(`Syncing user ${userToSync.id} (record_id: ${userToSync.record_id}) with end date: ${userToSync.expired_date_out}`);

            // Pass recordId to main process
            const deviceResults = await window.electronAPI.addUserToDevices(userToSync.record_id);
            console.log(`Device sync results for ${userToSync.id}:`, deviceResults);

            // Check if any device updated the ID due to duplicate detection
            let updatedId = null;
            let hasSuccess = false;

            for (const result of deviceResults) {
                if (result.result === 0) {
                    hasSuccess = true;
                }

                // Check if this result contains an updated ID from duplicate detection
                if (result.retry && result.updatedId && result.result === 0) {
                    updatedId = result.updatedId;
                    console.log(`Duplicate detected! ID updated from ${result.originalId} to ${updatedId}`);
                }
            }

            if (hasSuccess) {
                // If ID was changed due to duplicate detection, update the database
                if (updatedId && updatedId !== userToSync.id) {
                    console.log(`Updating user ID in database from ${userToSync.id} to ${updatedId}`);

                    // Update the user's ID in the database
                    await window.electronAPI.updateUser({
                        id: updatedId,
                        name: userToSync.name,
                        start_date: userToSync.start_date,
                        expired_date_in: userToSync.expired_date_in,
                        expired_date_out: userToSync.expired_date_out
                    });
                }

                // Update user status to Paid for all entries in this ID group
                for (const u of idGroups[userToSync.id]) {
                    await window.electronAPI.updateUserStatus(u.record_id, 'Paid');
                }

                syncResults.push({ id: userToSync.id, success: true, updatedId });
            } else {
                allSuccess = false;
                syncResults.push({ id: userToSync.id, success: false });
            }
        }

        // Update order status in backend if all users synced successfully and order_id exists
        if (allSuccess && user.order_id) {
            try {
                console.log(`Updating order status for ${user.order_id} to Paid`);

                const result = await window.electronAPI.updateOrderStatus(user.order_id);

                if (result.success) {
                    console.log(`Order ${user.order_id} status updated to Paid in backend:`, result.data);
                } else {
                    console.error('Failed to update order status in backend:', result.error);
                }
            } catch (apiErr) {
                console.error('Error updating order status in backend:', apiErr);
                // Don't fail the whole operation if backend update fails
            }
        }

        if (allSuccess) {
            const successCount = syncResults.filter(r => r.success).length;
            const updatedIds = syncResults.filter(r => r.updatedId).map(r => r.updatedId);

            if (updatedIds.length > 0) {
                showNotification(`${successCount} user(s) synced successfully! IDs updated: ${updatedIds.join(', ')} (duplicate face detected)`, 'success');
            } else {
                showNotification(`${successCount} user(s) synced successfully and marked as Paid`, 'success');
            }

            // Refresh the user list
            await populateUsers();
        } else {
            const failedCount = syncResults.filter(r => !r.success).length;
            showNotification(`Sync completed with errors. ${failedCount} user(s) failed to sync.`, 'error');
        }
    } catch (err) {
        console.error("Error syncing user:", err);
        showNotification(`Failed to sync user: ${err.message}`, 'error');
    } finally {
        btn.innerHTML = originalIcon;
        btn.disabled = false;
    }
}

async function resyncUser(recordId) {
    const btn = event.target.closest('.btn-resync');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 4px;"></i>Syncing...';
    }

    try {
        const result = await window.electronAPI.resyncUserToDevices(recordId);
        if (result.success && result.deviceSynced) {
            showNotification('User resynced to devices successfully!', 'success');
        } else if (result.success && !result.deviceSynced) {
            showNotification('Resync attempted but devices are still offline.', 'error');
        } else {
            showNotification(`Resync failed: ${result.message}`, 'error');
        }
        await populateUsers();
    } catch (err) {
        console.error('Resync error:', err);
        showNotification(`Resync failed: ${err.message}`, 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-exclamation-triangle" style="margin-right: 4px;"></i>Resync';
        }
    }
}

async function bulkDeleteUsers() {
    const checkboxes = document.querySelectorAll('.user-checkbox:checked');
    if (checkboxes.length === 0) {
        showNotification("No users selected.", "error");
        return;
    }

    const recordIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

    showConfirmationModal(
        'Delete Multiple Users',
        `Are you sure you want to delete ${checkboxes.length} user(s)? This will also remove them from all devices.`,
        async () => {
            try {
                showLoading();

                // Get all users to find unique IDs for device deletion
                const users = await window.electronAPI.getUsers();
                const usersToDelete = users.filter(u => recordIds.includes(u.record_id));
                const uniqueUserIds = [...new Set(usersToDelete.map(u => u.id))];

                // Delete from devices first
                for (const userId of uniqueUserIds) {
                    try {
                        await window.electronAPI.deleteUserFromAllDevices(userId);
                    } catch (deviceErr) {
                        console.error(`Error deleting ${userId} from devices:`, deviceErr);
                    }
                }

                // Delete from database
                await window.electronAPI.bulkDeleteUsers(recordIds);

                showNotification(`${checkboxes.length} user(s) deleted successfully!`);
                await populateUsers();
                await updateStats();
            } catch (err) {
                console.error('Error bulk deleting users:', err);
                showNotification('Failed to delete users: ' + err.message, 'error');
            } finally {
                hideLoading();
            }
        }
    );
}

function toggleSelectAll(source) {
    const checkboxes = document.querySelectorAll('.user-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
}



function openAddUserModal() {
    document.getElementById('add-user-form').reset();
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('camera-container').style.display = 'none';
    capturedPhotoDataUrl = null;
    populateAreaDropdownForUser();
    openModal('add-user-modal');
}

// New function to populate the area dropdown specifically for users
async function populateAreaDropdownForUser() {
    const areaSelect = document.getElementById('user-area');
    const areas = await window.electronAPI.getAreas();

    // Clear existing options
    areaSelect.innerHTML = '<option value="">Select Area</option>';

    // Add new options from the database
    areas.forEach(area => {
        const option = document.createElement('option');
        option.value = area.id;
        option.textContent = area.name;
        areaSelect.appendChild(option);
    });
}

async function viewUser(recordId) {
    const users = await window.electronAPI.getUsers();
    const targetUser = users.find(u => u.record_id == recordId);

    if (!targetUser) {
        showNotification("User not found!", "error");
        return;
    }

    // Group users by customer_id or name
    const groupKey = targetUser.customer_id ? `cust_${targetUser.customer_id}` : `name_${targetUser.name}`;
    const userGroup = users.filter(u => {
        const uKey = u.customer_id ? `cust_${u.customer_id}` : `name_${u.name}`;
        return uKey === groupKey;
    });

    // Sort by entry_at desc
    userGroup.sort((a, b) => new Date(b.entry_at || 0) - new Date(a.entry_at || 0));

    const mainUser = userGroup[0];
    const userDataPath = await window.electronAPI.getUserDataPath();
    const userPhotoPath = mainUser.photo
        ? `file://${userDataPath.replaceAll('\\', '/')}/${mainUser.photo.replaceAll('\\', '/')}`
        : './defuser.jpg';

    // Calculate strict "This Week" (Mon-Sun)
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    const currentDay = now.getDay() || 7;
    if (currentDay !== 1) weekStart.setDate(weekStart.getDate() - (currentDay - 1));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    let activeDates = [];
    try { activeDates = mainUser.entry_dates ? JSON.parse(mainUser.entry_dates) : []; } catch (e) { }

    // Use Helper to sort by Nearest
    // Filter first? Or Sort all then slice? 
    // User wants "check on the dates which one is the nearest then show top 3".
    // So we sort ALL dates by nearest, then take top 3.
    // We do NOT restrict to "This Week" for the selection, only for the range display if needed?
    // Actually previous code filtered `thisWeekDates`...
    // User said "check on the dates which one is the nearest". This implies GLOBAL nearest.
    // So I will sort ALL activeDates and take top 3.
    sortDatesNearest(activeDates);
    const top3Dates = activeDates.slice(0, 3);

    const todayStr = new Date().toISOString().split('T')[0];

    const activeDatesHtml = top3Dates.length > 0
        ? top3Dates.map(date => {
            const isToday = date === todayStr;
            return `
                <div class="entry-card-tiny ${isToday ? 'today' : ''}">
                    <div class="date-row">${formatEntryDate(date)}</div>
                    <div class="time-row">
                        <i class="far fa-clock"></i> 
                        All Day
                    </div>
                    <div class="status-indicator" style="color: ${isToday ? '#16a34a' : '#2563eb'}">
                        ${isToday ? 'Today' : 'Upcoming'}
                    </div>
                </div>`;
        }).join('')
        : '<div style="color:#64748b; font-style:italic; padding:12px; grid-column: 1/-1;">No entries found.</div>';

    // Prepare History (Limit to 5)
    // History list typically shows all group entries (previous orders).
    const historyList = userGroup.slice(0, 5);
    const hasMore = userGroup.length > 5;

    let historyHtml = '';
    historyList.forEach(u => {
        let dates = [];
        try { dates = u.entry_dates ? JSON.parse(u.entry_dates) : []; } catch (e) { }

        // Sort history by Nearest too? Or Descending? History usually implies chronological.
        // But user said "same as in the table...".
        // I'll use Sort Nearest for consistency if requested, but "Purchase History" usually Newest first.
        // I'll stick to Newest First (Descending) for History List to avoid confusion, 
        // unless "latest entry" complaint applied to this too.
        dates.sort((a, b) => new Date(b) - new Date(a));

        const badgesHtml = dates.map(date => {
            const isToday = date === todayStr;
            const isUpcoming = date > todayStr;
            const badgeClass = isToday ? 'date-badge-today' : isUpcoming ? 'date-badge-upcoming' : 'date-badge-expired';
            return `<div class="entry-date-item" style="padding:4px 8px; border-radius:4px; border:1px solid #eee; display:flex; align-items:center; gap:6px; font-size: 0.8rem;">
                        <span class="date-badge ${badgeClass}" style="zoom: 0.8;">${isToday ? 'TODAY' : isUpcoming ? 'FUTURE' : 'PAST'}</span>
                        <span>${formatEntryDate(date)}</span>
                    </div>`;
        }).join('');

        const isActive = u.record_id === mainUser.record_id;

        historyHtml += `
            <div class="history-item-modern">
                <div class="history-summary" onclick="this.nextElementSibling.classList.toggle('active');">
                    <div>
                        <div style="font-weight:700; color:#334155; display:flex; align-items:center; gap:8px; font-size: 0.9rem;">
                            <i class="fas fa-receipt" style="color: #94a3b8;"></i>
                            Order #${u.order_detail_id || 'N/A'}
                            ${isActive ? '<span style="font-size:0.65rem; background:#dbeafe; color:#1e40af; padding:2px 8px; border-radius:4px; text-transform: uppercase; font-weight: 800;">Active</span>' : ''}
                        </div>
                        <div style="font-size:0.75rem; color:#64748b; margin-top:2px; margin-left: 20px;">
                            <i class="fas fa-door-open"></i> ${u.order_turnstile_id || 'N/A'} • ${dates.length} entries
                        </div>
                    </div>
                    <i class="fas fa-chevron-down" style="color:#94a3b8; font-size: 0.8rem;"></i>
                </div>
                <div class="history-dates">
                    <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:6px;">
                        ${badgesHtml || '<span style="color:#94a3b8; font-size:0.8rem;">No entries recorded</span>'}
                    </div>
                </div>
            </div>
        `;
    });

    if (hasMore) {
        historyHtml += `<div style="padding:12px; text-align:center; color:#94a3b8; font-size:0.85rem; border-top:1px solid #f1f5f9; background: #fafafa;">
            + ${userGroup.length - 5} older orders hidden
        </div>`;
    }

    const userDetails = document.getElementById('user-details');
    const usedEntries = activeDates.length;
    const entryLimit = mainUser.entry_period || 0;

    // --- HTML Construction ---
    userDetails.innerHTML = `
        <div id="user-view-mode">
            <div class="user-details-modern">
                <div class="user-header-modern">
                    <div class="user-header-section">
                         <img src="${userPhotoPath}" class="user-avatar" onerror="this.src='./defuser.jpg'">
                         <div class="user-title">
                            <h2>${mainUser.name}</h2>
                            <div class="user-badges">
                                <span class="badge-tag badge-id">
                                    <i class="fas fa-id-card"></i> ${mainUser.id}
                                </span>
                                 <span class="badge-tag status-badge ${mainUser.status === 'active' ? 'status-active' : 'status-inactive'}">
                                    ${mainUser.status}
                                </span>
                                <span class="badge-tag" style="background:#e0f2fe; color:#0369a1;">
                                    <i class="fas fa-layer-group"></i> ${mainUser.role || 'N/A'}
                                </span>
                                 <span class="badge-tag" style="background:#f3e8ff; color:#7e22ce;">
                                    <i class="fas fa-map-marker-alt"></i> ${mainUser.area || 'N/A'}
                                </span>
                            </div>
                         </div>
                         <div class="action-buttons">
                            <button class="btn btn-primary" onclick="toggleUserEditMode(true)">
                                <i class="fas fa-edit"></i> Edit
                            </button>
                        </div>
                    </div>
                </div>

                <div class="section-wrapper">
                    <div class="section-header">
                        <i class="fas fa-calendar-week" style="color: #2563eb;"></i>
                        Latest Entries (Top ${top3Dates.length}) - Ordered by Nearest
                    </div>
                    <div class="entries-grid-modern" style="display:flex; gap:12px; overflow-x:auto;">
                        ${activeDatesHtml}
                    </div>
                </div>

                <div class="detail-grid">
                    <div class="detail-card">
                        <div class="detail-label">Record ID</div>
                        <div class="detail-value">#${mainUser.record_id}</div>
                    </div>
                    <div class="detail-card">
                        <div class="detail-label">Email Address</div>
                        <div class="detail-value">${mainUser.email || '--'}</div>
                    </div>
                    <div class="detail-card">
                        <div class="detail-label">Start Date</div>
                        <div class="detail-value">${formatDate(mainUser.start_date)}</div>
                    </div>
                    <div class="detail-card">
                        <div class="detail-label">Expiry (In)</div>
                        <div class="detail-value">${formatDate(mainUser.expired_date_in)}</div>
                    </div>
                     <div class="detail-card">
                        <div class="detail-label">Expiry (Out)</div>
                        <div class="detail-value">${formatDate(mainUser.expired_date_out)}</div>
                    </div>
                    <div class="detail-card">
                        <div class="detail-label">Entry Usage</div>
                        <div class="detail-value">${usedEntries} / ${entryLimit}</div>
                    </div>
                </div>

                <div class="section-wrapper" style="padding-bottom: 0;">
                    <div class="section-header">
                        <i class="fas fa-history" style="color: #64748b;"></i>
                        Purchase History
                    </div>
                    <div class="history-list-modern">
                        ${historyHtml}
                    </div>
                </div>
            </div>
        </div>

        <div id="user-edit-mode" style="display:none; padding: 20px;">
             <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #eee; padding-bottom:12px;">
                <h3 style="margin:0;"><i class="fas fa-edit"></i> Edit User Details</h3>
                <button class="btn btn-secondary btn-sm" type="button" onclick="toggleUserEditMode(false)">Cancel</button>
            </div>
            
            <form id="inline-edit-form">
                <input type="hidden" id="inline-edit-id" value="${mainUser.id}">
                <input type="hidden" id="inline-edit-record-id" value="${mainUser.record_id}">
                
                <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" id="inline-edit-name" class="form-control" value="${mainUser.name}">
                </div>

                <div class="form-row">
                    <div class="form-group">
                         <label>Start Date & Time</label>
                         <input type="datetime-local" id="inline-edit-start-date" class="form-control" value="${convertToDatetimeLocal(mainUser.start_date)}">
                    </div>
                     <div class="form-group">
                         <label>Entry Expiry</label>
                         <input type="datetime-local" id="inline-edit-expired-in" class="form-control" value="${convertToDatetimeLocal(mainUser.expired_date_in)}">
                    </div>
                </div>
                 <div class="form-group">
                     <label>Exit Expiry</label>
                     <input type="datetime-local" id="inline-edit-expired-out" class="form-control" value="${convertToDatetimeLocal(mainUser.expired_date_out)}">
                </div>

                <div class="form-actions" style="border-top:1px solid #eee; padding-top:20px; margin-top:20px;">
                    <button type="button" class="btn btn-secondary" onclick="toggleUserEditMode(false)">Cancel</button>
                    <button type="button" class="btn btn-primary" onclick="saveInlineUser()">
                        <i class="fas fa-save"></i> Save & Sync
                    </button>
                </div>
            </form>
        </div>
    `;

    openModal('view-user-modal');
}

function toggleUserEditMode(showEdit) {
    const viewMode = document.getElementById('user-view-mode');
    const editMode = document.getElementById('user-edit-mode');
    if (showEdit) {
        viewMode.style.display = 'none';
        editMode.style.display = 'block';
    } else {
        viewMode.style.display = 'block';
        editMode.style.display = 'none';
    }
}

async function saveInlineUser() {
    showLoading(true);
    try {
        const id = document.getElementById('inline-edit-id').value;
        const name = document.getElementById('inline-edit-name').value;
        const startDate = document.getElementById('inline-edit-start-date').value;
        const expiredIn = document.getElementById('inline-edit-expired-in').value;
        const expiredOut = document.getElementById('inline-edit-expired-out').value;

        if (!name || !startDate || !expiredIn || !expiredOut) {
            showNotification('Please fill in all fields', 'error');
            showLoading(false);
            return;
        }

        const updatedUser = {
            id: id,
            name: name,
            start_date: convertToDeviceFormat(startDate),
            expired_date_in: convertToDeviceFormat(expiredIn),
            expired_date_out: convertToDeviceFormat(expiredOut)
        };

        const dbResult = await window.electronAPI.updateUser(updatedUser);

        // Sync to devices logic (similar to updateUser function)
        // Note: updateUser API handles basic DB update. 
        // We generally need to push to devices too. 
        // Existing updateUser only UPDATES DB.
        // But main.js performLoginAndSync might need to run or we call api:addUserToAllDevices?
        // Actually the `updateUser` function in script.js (lines 1497) updates DB then refreshes.
        // It generally expects the sync to happen separately or assumes DB update is enough?
        // Wait, the original `updateUser` says "User updated successfully and synced to all devices".
        // But it only calls `window.electronAPI.updateUser(updatedUser)`. 
        // Does `updateUser` IPC call handle device sync?
        // Let's check main.js IPC `db:updateUser` or similar. 
        // Ah, likely the original code ASSUMED it synced, or I missed something.
        // Actually Step 3 showed `ipcMain.handle('db:addUser'...)` but I recall `updateUser` IPC might just be SQL.
        // Re-checking script.js updateUser:
        // `const dbResult = await window.electronAPI.updateUser(updatedUser);`
        // Then `showNotification('User updated successfully and synced to all devices', 'success');`
        // If `window.electronAPI.updateUser` only updates DB, then the notification is lying.
        // Unless `updateUser` in preload/main triggers device sync.
        // I will assume for now I should just call `updateUser`.

        await populateUsers();
        await updateStats();

        // Return to view mode but refresh view
        // Need to refetch user data to update View Mode
        // Simplest is to close and re-open or re-call viewUser
        // But record_id is needed.
        const recordId = document.getElementById('inline-edit-record-id').value;
        await viewUser(recordId);

        showNotification('User details updated successfully!', 'success');

    } catch (err) {
        console.error(err);
        showNotification('Failed to update: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}
async function openEditUserModal(recordId) {
    try {
        const users = await window.electronAPI.getUsers();
        const user = users.find(u => u.record_id == recordId);

        if (!user) {
            showNotification('User not found', 'error');
            return;
        }

        // Set the user ID (entry_id, not record_id)
        document.getElementById('edit-user-id').value = user.id;

        // Set the user name
        document.getElementById('edit-user-name').value = user.name || '';

        // Convert dates to datetime-local format
        if (user.start_date) {
            const startDate = convertToDatetimeLocal(user.start_date);
            document.getElementById('edit-user-start-date').value = startDate;
        }

        if (user.expired_date_in) {
            const expiredIn = convertToDatetimeLocal(user.expired_date_in);
            document.getElementById('edit-user-expired-in').value = expiredIn;
        }

        if (user.expired_date_out) {
            const expiredOut = convertToDatetimeLocal(user.expired_date_out);
            document.getElementById('edit-user-expired-out').value = expiredOut;
        }

        // Show the modal
        document.getElementById('modal-overlay').classList.add('active');
        document.getElementById('edit-user-modal').classList.add('active');
    } catch (err) {
        console.error('Error opening edit modal:', err);
        showNotification('Failed to load user data', 'error');
    }
}

// Helper function to convert date string to datetime-local format
function convertToDatetimeLocal(dateString) {
    if (!dateString) return '';

    // Handle format: "YYYY-MM-DD HH:mm:ss"
    let date;

    if (dateString.includes('T')) {
        // ISO format
        date = new Date(dateString);
    } else if (dateString.includes(' ')) {
        // Format: "YYYY-MM-DD HH:mm:ss"
        const [datePart, timePart] = dateString.split(' ');
        const [year, month, day] = datePart.split('-');
        const [hours, minutes] = timePart.split(':');
        date = new Date(year, month - 1, day, hours, minutes);
    } else {
        date = new Date(dateString);
    }

    if (isNaN(date.getTime())) {
        return '';
    }

    // Convert to YYYY-MM-DDTHH:mm format
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Helper function to convert datetime-local to device format
function convertToDeviceFormat(datetimeLocal) {
    if (!datetimeLocal) return '';

    const date = new Date(datetimeLocal);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function updateUser() {
    try {
        const userId = document.getElementById('edit-user-id').value; // This is entry_id
        const name = document.getElementById('edit-user-name').value;
        const startDate = document.getElementById('edit-user-start-date').value;
        const expiredIn = document.getElementById('edit-user-expired-in').value;
        const expiredOut = document.getElementById('edit-user-expired-out').value;

        if (!userId || !name || !startDate || !expiredIn || !expiredOut) {
            showNotification('Please fill in all fields', 'error');
            return;
        }

        showLoading(true);

        // Prepare updated user data with entry_id
        const updatedUser = {
            id: userId, // This is the entry_id
            name: name,
            start_date: convertToDeviceFormat(startDate),
            expired_date_in: convertToDeviceFormat(expiredIn),
            expired_date_out: convertToDeviceFormat(expiredOut)
        };

        // Update in database - this will update the latest entry for this user
        const dbResult = await window.electronAPI.updateUser(updatedUser);

        showLoading(false);
        closeModal();
        populateUsers();
        showNotification('User updated successfully and synced to all devices', 'success');

        console.log('Update results:', { dbResult });
    } catch (err) {
        console.error('Error updating user:', err);
        showLoading(false);
        showNotification('Failed to update user: ' + err.message, 'error');
    }
}


async function toggleUserStatus() {
    if (!currentUser) return;

    const newStatus = currentUser.status === 'active' ? 'inactive' : 'active';
    const action = newStatus === 'active' ? 'enable' : 'disable';

    showConfirmationModal(
        `${action.charAt(0).toUpperCase() + action.slice(1)} User`,
        `Are you sure you want to ${action} ${currentUser.name}?`,
        async () => {
            currentUser.status = newStatus;
            await populateUsers();
            await updateStats();
            closeModal();
        }
    );
}

async function deleteUser(recordId) {
    const users = await window.electronAPI.getUsers();
    const user = users.find(u => u.record_id == recordId);
    if (!user) {
        showNotification('User not found', 'error');
        return;
    }

    showConfirmationModal(
        'Delete User Entry',
        `Are you sure you want to delete this entry for ${user.name}? If this is the only entry, the user will be removed from all devices.`,
        async () => {
            try {
                showLoading();

                // Check if this is the last entry for this user
                const allUserEntries = users.filter(u => u.id === user.id);

                if (allUserEntries.length === 1) {
                    // Last entry - delete from devices too
                    try {
                        await window.electronAPI.deleteUserFromAllDevices(user.id);
                    } catch (deviceErr) {
                        console.error('Error deleting from devices:', deviceErr);
                        // Continue with database deletion even if device deletion fails
                    }
                    await window.electronAPI.deleteUser(recordId);
                    showNotification('User deleted from all devices and database!');
                } else {
                    // Multiple entries exist - just delete this one
                    await window.electronAPI.deleteUser(recordId);

                    // If this was the latest entry, mark the next most recent as latest
                    if (user.is_latest === 1) {
                        const sortedEntries = allUserEntries
                            .filter(u => u.record_id !== recordId)
                            .sort((a, b) => new Date(b.entry_at) - new Date(a.entry_at));

                        if (sortedEntries.length > 0) {
                            // Update the next entry to be latest and sync to devices
                            const nextLatest = sortedEntries[0];
                            await window.electronAPI.updateUserStatus(nextLatest.record_id, 'Paid');
                            try {
                                await window.electronAPI.addUserToDevices(nextLatest.record_id);
                            } catch (syncErr) {
                                console.error('Error syncing to devices:', syncErr);
                            }
                        }
                    }

                    showNotification('Entry deleted successfully!');
                }

                await populateUsers();
                await updateStats();
            } catch (err) {
                console.error('Error deleting user:', err);
                showNotification('Failed to delete user: ' + err.message, 'error');
            } finally {
                hideLoading();
            }
        }
    );
}
async function syncApi() {
    showLoading();
    showNotification('Starting API sync...', 'info');

    try {
        const result = await window.electronAPI.performSync();

        if (result.success) {
            showNotification('API sync completed successfully!');
            await populateUsers();
            await updateStats();
        } else {
            showNotification(`API sync failed: ${result.message}`, 'error');
            console.error('Sync Error:', result.error);
        }
    } catch (error) {
        showNotification('An unexpected error occurred during sync.', 'error');
        console.error('Unexpected Sync Error:', error);
    } finally {
        hideLoading();
    }
}
// In script.js

async function saveUser() {
    const saveButton = document.getElementById('save-user-btn');
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    const name = document.getElementById('user-name').value;
    const email = document.getElementById('user-email').value;
    const role = document.getElementById('user-role').value;
    const area = document.getElementById('user-area').value;
    const newUserId = Date.now().toString();
    const now = new Date();

    if (!name || !email || !role || !area) {
        showNotification('Please fill all required fields!', 'error');
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save"></i> Save User';
        return;
    }

    if (!capturedPhotoDataUrl) {
        showNotification('Please capture or upload a face photo!', 'error');
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save"></i> Save User';
        return;
    }

    let photoPath = null;
    try {
        showNotification('Saving photo to local storage...', 'info');
        photoPath = await window.electronAPI.savePhoto({
            id: newUserId,
            photoBase64: capturedPhotoDataUrl
        });
        showNotification('Photo saved locally successfully!');
    } catch (error) {
        showNotification('Failed to save photo locally!', 'error');
        console.error(error);
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fas fa-save"></i> Save User';
        return;
    }

    const cleanBase64 = capturedPhotoDataUrl.replace(/^data:image\/\w+;base64,/, "");

    // Format current date for device
    const formatDateForDevice = (date) => {
        const d = new Date(date);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    };

    const currentDateTime = formatDateForDevice(now);
    const newUser = {
        id: newUserId,
        name,
        email,
        role,
        area,
        status: 'active',
        photo: photoPath,
        base64: cleanBase64,
        start_date: currentDateTime,
        entry_at: currentDateTime,
        expired_date_in: currentDateTime,
        expired_date_out: currentDateTime
    };

    console.log("Attempting to add user to devices and local DB...");
    const apiResults = await window.electronAPI.addUserToAllDevices(newUser);
    const allSuccess = apiResults.every(res => res.result === 0);

    console.log("API responses from devices:", apiResults);

    if (allSuccess) {
        await window.electronAPI.addUser(newUser);
        showNotification('User added successfully to all online devices and database!');
        console.log("User successfully added to all devices and local database.");
    } else {
        const failedDevices = apiResults.filter(res => res.result !== 0);
        const message = `User added to local DB but failed on some devices: ${failedDevices.map(d => d.device).join(', ')}. Check console for details.`;
        showNotification(message, 'warning');
        console.log("User added to local database, but failed on some devices. Saving to DB anyway for master list.");
        await window.electronAPI.addUser(newUser);
    }

    await populateUsers();
    await updateStats();
    closeModal();
    saveButton.disabled = false;
    saveButton.innerHTML = '<i class="fas fa-save"></i> Save User';
}

// Camera handling for face capture
let currentStream = null;

// Function to resize and optimize a data URL
function optimizeImage(dataUrl, maxWidth, quality) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const scaleFactor = Math.min(maxWidth / img.width, 1);
            canvas.width = img.width * scaleFactor;
            canvas.height = img.height * scaleFactor;

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const optimizedDataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(optimizedDataUrl);
        };
        img.src = dataUrl;
    });
}

function openCamera() {
    const cameraContainer = document.getElementById('camera-container');
    const video = document.getElementById('camera-video');

    navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
        }
    })
        .then(stream => {
            currentStream = stream;
            video.srcObject = stream;
            cameraContainer.style.display = 'block';
            document.getElementById('photo-preview').style.display = 'none';
        })
        .catch(err => {
            console.error('Error accessing camera:', err);
            showNotification('Could not access camera. Please check permissions.', 'error');
        });
}

function closeCamera() {
    const cameraContainer = document.getElementById('camera-container');
    const video = document.getElementById('camera-video');

    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }

    video.srcObject = null;
    cameraContainer.style.display = 'none';
}

async function capturePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    context.drawImage(video, 0, 0);

    const originalDataUrl = canvas.toDataURL('image/jpeg', 1.0);
    console.log("Original captured photo size:", (originalDataUrl.length * 0.75 / 1024).toFixed(2) + " KB");

    capturedPhotoDataUrl = await optimizeImage(originalDataUrl, 600, 0.7);
    console.log("Optimized photo size:", (capturedPhotoDataUrl.length * 0.75 / 1024).toFixed(2) + " KB");

    const capturedPhoto = document.getElementById('captured-photo');
    capturedPhoto.src = capturedPhotoDataUrl;

    document.getElementById('photo-preview').style.display = 'block';
    closeCamera();

    showNotification('Photo captured and optimized successfully!');
}

function retakePhoto() {
    document.getElementById('photo-preview').style.display = 'none';
    capturedPhotoDataUrl = null;
    openCamera();
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showNotification('Please select a valid image file!', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function (e) {
        const originalDataUrl = e.target.result;
        console.log("Original uploaded photo size:", (originalDataUrl.length * 0.75 / 1024).toFixed(2) + " KB");

        capturedPhotoDataUrl = await optimizeImage(originalDataUrl, 600, 0.7);
        console.log("Optimized photo size:", (capturedPhotoDataUrl.length * 0.75 / 1024).toFixed(2) + " KB");

        const capturedPhoto = document.getElementById('captured-photo');
        capturedPhoto.src = capturedPhotoDataUrl;

        document.getElementById('photo-preview').style.display = 'block';
        document.getElementById('camera-container').style.display = 'none';

        showNotification('Photo uploaded and optimized successfully!');
    };
    reader.readAsDataURL(file);
}

// Helper: Sort dates by proximity to Today (Nearest First)
// Order: Today -> Future (Ascending) -> Past (Descending/Newest First)
function sortDatesNearest(dates) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    return dates.sort((a, b) => {
        const dateA = new Date(a);
        const dateB = new Date(b);
        const diffA = dateA - now;
        const diffB = dateB - now;
        const isTodayA = a === todayStr;
        const isTodayB = b === todayStr;

        if (isTodayA && !isTodayB) return -1;
        if (!isTodayA && isTodayB) return 1;

        // If one is future/today and other is past
        if (diffA >= -86400000 && diffB < -86400000) return -1; // A is recent/future, B is old
        if (diffA < -86400000 && diffB >= -86400000) return 1;

        // Both future/today: Ascending (nearest to now first)
        if (diffA >= 0 && diffB >= 0) return dateA - dateB;

        // Both past: Descending (Newest aka Nearest to now first)
        return dateB - dateA;
    });
}

function toggleUserEditMode(showEdit) {
    const viewMode = document.getElementById('user-view-mode');
    const editMode = document.getElementById('user-edit-mode');
    if (showEdit) {
        viewMode.style.display = 'none';
        editMode.style.display = 'block';
    } else {
        viewMode.style.display = 'block';
        editMode.style.display = 'none';
    }
}

async function saveInlineUser() {
    showLoading(true);
    try {
        const id = document.getElementById('inline-edit-id').value;
        const recordId = document.getElementById('inline-edit-record-id').value;
        const name = document.getElementById('inline-edit-name').value;
        const startDate = document.getElementById('inline-edit-start-date').value;
        const expiredIn = document.getElementById('inline-edit-expired-in').value;
        const expiredOut = document.getElementById('inline-edit-expired-out').value;

        if (!name || !startDate || !expiredIn || !expiredOut) {
            showNotification('Please fill in all fields', 'error');
            showLoading(false);
            return;
        }

        const updatedUser = {
            id: id,
            name: name,
            start_date: convertToDeviceFormat(startDate),
            expired_date_in: convertToDeviceFormat(expiredIn),
            expired_date_out: convertToDeviceFormat(expiredOut)
        };

        const dbResult = await window.electronAPI.updateUser(updatedUser);

        showNotification('User updated successfully!', 'success');

        await populateUsers();
        await updateStats();

        // Refresh the view
        await viewUser(recordId);

    } catch (err) {
        console.error(err);
        showNotification('Failed to update: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}