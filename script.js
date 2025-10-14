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
    if (!dateStr) {
        return 'N/A';
    }
    
    // Split the date and time components
    const [datePart, timePart] = dateStr.split(' ');
    const [year, month, day] = datePart.split('-');
    const [hours, minutes, seconds] = timePart.split(':');

    // Create a new Date object using the components (safer than string parsing)
    const d = new Date(year, month - 1, day, hours, minutes, seconds);

    // Check if the date is valid. If not, return 'Invalid Date'.
    if (isNaN(d.getTime())) {
        return 'Invalid Date';
    }

    // Format the date to DD-MM-YY
    const formattedDay = String(d.getDate()).padStart(2, '0');
    const formattedMonth = String(d.getMonth() + 1).padStart(2, '0');
    const formattedYear = String(d.getFullYear()).slice(-2);
    
    // Get time with seconds
    const formattedHours = String(d.getHours()).padStart(2, '0');
    const formattedMinutes = String(d.getMinutes()).padStart(2, '0');
    const formattedSeconds = String(d.getSeconds()).padStart(2, '0');

    return `${formattedDay}-${formattedMonth}-${formattedYear} ${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

document.addEventListener('DOMContentLoaded', async function() {
    initializeNavigation();
    setupEventListeners();
    await initializeDashboard();
});

// Navigation handling
function initializeNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', async function(e) {
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
    document.getElementById('modal-overlay').addEventListener('click', function(e) {
        if (e.target === this) {
            closeModal();
        }
    });

    const confirmInput = document.getElementById('confirm-input');
    if (confirmInput) {
        confirmInput.addEventListener('input', function() {
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
    document.getElementById('user-search').addEventListener('input', function() {
        filterTable('users-table', this.value);
    });

    document.getElementById('area-search').addEventListener('input', function() {
        filterTable('areas-table', this.value);
    });

    document.getElementById('device-search').addEventListener('input', function() {
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
    document.getElementById('confirm-input').value = '';
    document.getElementById('confirm-action-btn').disabled = true;
    confirmAction = action;
    openModal('confirmation-modal');
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
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No users found. Add a new user to get started.</td></tr>';
        hideLoading();
        return;
    }

    tbody.innerHTML = users.map(user => {
        const statusClass = user.status === 'Paid' ? 'status-active' : 'status-inactive';
        let userPhotoPath;
        if (user.photo) {
            userPhotoPath = `file://${userDataPath.replaceAll('\\', '/')}/${user.photo.replaceAll('\\', '/')}`;
        } else {
            userPhotoPath = './defuser.jpg';
        }

        const syncButton = user.status !== 'Paid' 
        ? `<button class="btn-icon btn-sync" id="sync-btn-${user.id}" onclick="syncUserToDevices('${user.id}')" title="Sync to Device">
               <i class="fas fa-sync-alt"></i>
           </button>` 
        : '';

        return `
        <tr>
            <td>
                <input type="checkbox" class="user-checkbox" value="${user.id}">
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="${userPhotoPath}" alt="${user.name}" 
                          style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                    ${user.name}
                </div>
            </td>
            <td>${user.order_detail_id || 'N/A'}</td>
            <td>${user.order_id || 'N/A'}</td>
            <td>${formatDate(user.expired_date_out)}</td>
            <td><span class="status-badge ${statusClass}">${user.status}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon btn-view" onclick="viewUser('${user.id}')" title="View User">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon btn-edit" onclick="openEditUserModal('${user.id}')" title="Edit User">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="deleteUser('${user.id}')" title="Delete User">
                        <i class="fas fa-trash"></i>
                    </button>
                     ${syncButton}
                </div>
            </td>
        </tr>
        `;
    }).join('');
    hideLoading();
}
async function syncUserToDevices(userId) {
    const btn = document.getElementById(`sync-btn-${userId}`);
    const originalIcon = btn.innerHTML;

    // Show a preload/spinner
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        // Pass only userId; main process will fetch user from DB
        const deviceResults = await window.electronAPI.addUserToDevices(userId);
        console.log("Device sync results:", deviceResults);

        // Check if any device returned result 0 (success)
        const isSuccess = deviceResults.some(r => r.result === 0);

        if (isSuccess) {
            // Update user status in main process / DB
            await window.electronAPI.updateUserStatus(userId, 'Paid');

            // Remove the sync button from UI instantly
            btn.remove();

            alert(`User synced successfully and marked as Paid`);
            await populateUsers();
        } else {
            alert(`Failed to sync user to devices`);
        }
    } catch (err) {
        console.error("Error syncing user:", err);
        alert(`Failed to sync user`);
    } finally {
        btn.innerHTML = originalIcon;
        btn.disabled = false;
    }
}




async function bulkDeleteUsers() {
    const checkboxes = document.querySelectorAll('.user-checkbox:checked');
    if (checkboxes.length === 0) {
        alert("No users selected.");
        return;
    }

    if (!confirm(`Are you sure you want to delete ${checkboxes.length} user(s)?`)) {
        return;
    }

    const ids = Array.from(checkboxes).map(cb => cb.value);
    await window.electronAPI.bulkDeleteUsers(ids);
    populateUsers();
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

async function viewUser(userId) {
    const users = await window.electronAPI.getUsers();
    const user = users.find(u => u.id == userId);
    if (!user) {
        showNotification("User not found!", "error");
        return;
    }

    currentUser = user;
    const userDataPath = await window.electronAPI.getUserDataPath();
    let userPhotoPath;
    if (user.photo) {
        userPhotoPath = `file://${userDataPath.replaceAll('\\', '/')}/${user.photo.replaceAll('\\', '/')}`;
    } else {
        userPhotoPath = './defuser.jpg';
    }
    const userDetails = document.getElementById('user-details');
    userDetails.innerHTML = `
        <div class="user-photo">
            <img src="${userPhotoPath}" alt="${user.name}">
            <p class="text-center">${user.name}</p>
        </div>
        <div class="user-info">
            <div class="info-item">
                <span class="info-label">ID:&nbsp;</span>
                <span class="info-value"> ${user.id}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Full Name:&nbsp;</span>
                <span class="info-value"> ${user.name}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Email:&nbsp;</span>
                <span class="info-value"> ${user.email || 'N/A'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Role:&nbsp;</span>
                <span class="info-value"> ${user.role}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Area Access:&nbsp;</span>
                <span class="info-value"> ${user.area}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Status: &nbsp;</span>
                <span class="status-badge status-${user.status === 'Paid' ? 'active' : 'inactive'}">${user.status}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Order Detail ID:&nbsp;</span>
                <span class="info-value"> ${user.order_detail_id || 'N/A'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Order ID:&nbsp;</span>
                <span class="info-value"> ${user.order_id || 'N/A'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Start Date:&nbsp;</span>
                <span class="info-value"> ${formatDate(user.start_date)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Expired Date (In):&nbsp;</span>
                <span class="info-value"> ${formatDate(user.expired_date_in)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Expired Date (Out):&nbsp;</span>
                <span class="info-value"> ${formatDate(user.expired_date_out)}</span>
            </div>
        </div>
    `;

    const toggleBtn = document.getElementById('toggle-user-btn');
    if (user.status === 'active') {
        toggleBtn.innerHTML = '<i class="fas fa-user-slash"></i> Disable User';
        toggleBtn.className = 'btn btn-warning';
    } else {
        toggleBtn.innerHTML = '<i class="fas fa-user-check"></i> Enable User';
        toggleBtn.className = 'btn btn-success';
    }

    openModal('view-user-modal');
}

async function openEditUserModal(userId) {
    const users = await window.electronAPI.getUsers();
    const user = users.find(u => u.id == userId);
    if (!user) {
        showNotification("User not found!", "error");
        return;
    }

    currentEditingUser = user;

    console.log(user)
    
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-name').value = user.name;
    document.getElementById('edit-user-start-date').value = formatDateForInput(user.start_date);
    document.getElementById('edit-user-expired-in').value = formatDateForInput(user.expired_date_in);
    document.getElementById('edit-user-expired-out').value = formatDateForInput(user.expired_date_out);
    
    openModal('edit-user-modal');
}

async function updateUser() {
    const updateBtn = document.getElementById('update-user-btn');
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

    const userId = document.getElementById('edit-user-id').value;
    const name = document.getElementById('edit-user-name').value;
    const startDate = document.getElementById('edit-user-start-date').value;
    const expiredIn = document.getElementById('edit-user-expired-in').value;
    const expiredOut = document.getElementById('edit-user-expired-out').value;

    if (!expiredOut) {
        showNotification('Please fill all required fields!', 'error');
        updateBtn.disabled = false;
        updateBtn.innerHTML = '<i class="fas fa-save"></i> Update User';
        return;
    }

    const updatedUser = {
        id: userId,
        name: name,
        start_date: formatDateFromInput(startDate),
        expired_date_in: formatDateFromInput(expiredIn),
        expired_date_out: formatDateFromInput(expiredOut)
    };

    try {
        showLoading();
        showNotification('Updating user in database and syncing to devices...', 'info');
        
        // Update in local database AND sync to all devices in one call
        const result = await window.electronAPI.updateUser(updatedUser);
        
        console.log('Update result:', result);
        
        if (result.success) {
            const { syncSummary } = result;
            
            if (syncSummary.successful === syncSummary.total) {
                // All devices synced successfully
                showNotification(`User updated successfully! Synced to all ${syncSummary.total} device(s).`);
            } else if (syncSummary.successful > 0) {
                // Some devices synced
                showNotification(
                    `User updated! Synced to ${syncSummary.successful}/${syncSummary.total} device(s). ${syncSummary.failed} device(s) failed.`,
                    'warning'
                );
            } else {
                // No devices synced but DB updated
                showNotification(
                    'User updated in database, but failed to sync to devices. Check if devices are online.',
                    'warning'
                );
            }
            
            await populateUsers();
            await updateStats();
            closeModal();
        } else {
            showNotification(`Failed to update user: ${result.message}`, 'error');
        }
    } catch (error) {
        showNotification('Failed to update user.', 'error');
        console.error('Failed to update user:', error);
    } finally {
        hideLoading();
        updateBtn.disabled = false;
        updateBtn.innerHTML = '<i class="fas fa-save"></i> Update User';
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

async function deleteUser(userId) {
    const users = await window.electronAPI.getUsers();
    const user = users.find(u => u.id == userId);
    if (!user) return;

    showConfirmationModal(
        'Delete User',
        `Are you sure you want to permanently delete ${user.name}? This action will also delete the user from all devices.`,
        async () => {
            const apiResults = await window.electronAPI.deleteUserFromAllDevices(user.id);
            const allSuccess = apiResults.every(res => res.result === 0);

            console.log(userId)

            if (allSuccess) {
                await window.electronAPI.deleteUser(userId);
                showNotification('User deleted successfully from all devices and database!');
                console.log("User successfully added to all devices and local database.");
            } else {
                const failedDevices = apiResults.filter(res => res.result !== 0);
                const message = `User deleted from local DB but failed on some devices: ${failedDevices.map(d => d.device).join(', ')}. Check console for details.`;
                showNotification(message, 'warning');
                console.log("User added to local database, but failed on some devices. Saving to DB anyway for master list.");
                await window.electronAPI.deleteUser(userId);
            }
            await populateUsers();
            await updateStats();
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
    const newUser = {
        id: newUserId,
        name,
        email,
        role,
        area,
        status: 'active',
        photo: photoPath,
        base64: cleanBase64
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
    reader.onload = async function(e) {
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