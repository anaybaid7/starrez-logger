// ============================================================================
// StarRez Package Logger v2.2 - FIXED LOCKOUT PLACEMENT
// ============================================================================
// PURPOSE: Automates logging for UWP Front Desk operations in StarRez
// 
// FEATURES:
// 1. Package Log Buttons - Generate formatted package pickup logs
// 2. Lockout Log Button - Generate formatted lockout key logs  
// 3. Print Label Button - Generate formatted package labels for printing
//
// AUTHOR: Front Desk Automation Team
// LAST UPDATED: January 2026
// ============================================================================

const CONFIG = {
    DEBUG: true, // Set to false in production to reduce console output
    
    // Pattern matching for residence codes (supports all UW residences)
    RESIDENCE_PATTERN: /[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i,
    
    // Validation patterns
    STUDENT_NUMBER_PATTERN: /^\d{8}$/,
    
    // Timing configuration (in milliseconds)
    CACHE_DURATION: 10000,            // How long to trust cached data
    INIT_DEBOUNCE: 500,              // Reduced from 1000ms for faster initial load
    OBSERVER_DEBOUNCE: 800,          // Reduced from 1500ms for faster response
    BUTTON_ENABLE_DELAY: 1000,       // Reduced from 2000ms for faster availability
    PREVIEW_DURATION: 4000,          // How long to show success popup
    MAX_VALIDATION_ATTEMPTS: 10,     // Max retries waiting for data
    
    // Profile change detection
    PROFILE_CHANGE_INDICATORS: [
        'habitat-header-breadcrumb-item', // Primary indicator
        '.ui-tabs-panel:not(.ui-tabs-hide)' // Secondary indicator
    ]
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================
// Centralized state to track application data and prevent memory leaks

const state = {
    // Last successfully extracted student data
    lastExtracted: {
        name: null,
        studentNumber: null,
        roomSpace: null,
        timestamp: null
    },
    
    // Current profile tracking
    lastBreadcrumb: null,
    lastProfileHash: null, // Hash of profile content for change detection
    
    // Validation tracking
    validationAttempts: 0,
    
    // Timer references for cleanup
    timers: {
        init: null,
        observer: null
    }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Logs debug messages to console when DEBUG is enabled
 */
const log = (...args) => CONFIG.DEBUG && console.log('[PKG-LOGGER]', ...args);

/**
 * Logs error messages to console (always enabled)
 */
const error = (...args) => console.error('[PKG-LOGGER ERROR]', ...args);

/**
 * Clears a named timer to prevent memory leaks
 * @param {string} timerName - Name of timer in state.timers object
 */
const clearTimer = (timerName) => {
    if (state.timers[timerName]) {
        clearTimeout(state.timers[timerName]);
        state.timers[timerName] = null;
    }
};

/**
 * Generates a simple hash of profile content for change detection
 * @param {string} content - Text content to hash
 * @returns {number} Simple numeric hash
 */
function simpleHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
}

// ============================================================================
// STAFF DATA EXTRACTION
// ============================================================================

/**
 * Extracts the logged-in staff member's name from Pendo analytics script
 * @returns {string|null} Staff member's full name or null if not found
 */
function getStaffName() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
        const match = script.textContent.match(/full_name:\s*`([^`]+)`/);
        if (match?.[1]) {
            log('Staff name found:', match[1]);
            return match[1];
        }
    }
    error('Staff name not found in Pendo script');
    return null;
}

/**
 * Converts full name to initials in FIRSTNAME.LASTNAME format
 * Handles StarRez's "LastName, FirstName" format
 * @param {string} fullName - Full name to convert
 * @returns {string} Formatted initials (e.g., "J.D" for "Doe, John")
 */
function getInitials(fullName) {
    if (!fullName) return 'X.X';
    
    // Handle "LastName, FirstName" format (StarRez standard)
    if (fullName.includes(',')) {
        const [lastName, firstName = ''] = fullName.split(',').map(p => p.trim());
        log(`Parsing: "${fullName}" -> Last: "${lastName}", First: "${firstName}"`);
        
        const getInitials = (name) => name
            .split(/\s+/)
            .filter(n => n.length > 0)
            .map(n => n[0].toUpperCase())
            .join('');
        
        // FIRST NAME . LAST NAME format
        const result = `${getInitials(firstName)}.${getInitials(lastName)}`;
        log(`Initials: ${result}`);
        return result;
    }
    
    // Fallback for non-standard format
    const parts = fullName.split(/\s+/).filter(p => p.length > 0);
    if (parts.length >= 2) {
        const firstInitials = parts.slice(0, -1).map(n => n[0].toUpperCase()).join('');
        const lastInitial = parts[parts.length - 1][0].toUpperCase();
        return `${firstInitials}.${lastInitial}`;
    }
    
    return parts.map(p => p[0]).join('').toUpperCase() + '.X';
}

// ============================================================================
// PROFILE DETECTION AND NAVIGATION HANDLING
// ============================================================================

/**
 * Gets the current student profile from breadcrumb navigation
 * @returns {string|null} Student name from breadcrumb or null if not on profile
 */
function getCurrentBreadcrumb() {
    const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
    for (const crumb of breadcrumbs) {
        const text = crumb.textContent.trim();
        // Student names have commas, exclude navigation items
        if (text.includes(',') && !text.includes('Dashboard') && !text.includes('Desk')) {
            return text;
        }
    }
    return null;
}

/**
 * Detects if the profile has changed by comparing content hash
 * @returns {boolean} True if profile content has changed
 */
function hasProfileChanged() {
    const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    const currentHash = simpleHash(container.innerText.substring(0, 500)); // Use first 500 chars
    
    if (state.lastProfileHash !== null && state.lastProfileHash !== currentHash) {
        log('Profile content changed (hash mismatch)');
        return true;
    }
    
    state.lastProfileHash = currentHash;
    return false;
}

// ============================================================================
// STUDENT DATA EXTRACTION
// ============================================================================

/**
 * Extracts student data from the Rez 360 profile section
 * Uses multiple fallback methods for robust bedspace detection
 * @returns {Object|null} Student data object or null if extraction fails
 */
function getStudentDataFromRez360() {
    const data = {};
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    let containerText = detailContainer.innerText;
    
    // Isolate Rez 360 section to avoid grabbing data from other sections
    const entryIdIndex = containerText.indexOf('EntryID:');
    if (entryIdIndex !== -1) {
        containerText = containerText.substring(entryIdIndex);
        log('Isolated Rez 360 section');
    }
    
    // Extract student name from breadcrumb (most reliable source)
    data.fullName = getCurrentBreadcrumb();
    if (!data.fullName) {
        error('Student name not found');
    } else {
        log('Name:', data.fullName);
    }
    
    // Extract 8-digit student number
    const studentNumMatch = containerText.match(/Student Number\s+(\d{8})/);
    if (studentNumMatch) {
        data.studentNumber = studentNumMatch[1];
        log('Student number:', data.studentNumber);
    } else {
        error('Student number not found');
    }
    
    // Extract bedspace using multiple fallback methods
    data.roomSpace = extractBedspace(containerText, detailContainer);
    
    if (!data.roomSpace) {
        error('Bedspace not found');
    }
    
    // Validate all extracted data
    return validateStudentData(data);
}

/**
 * Attempts to extract bedspace using multiple methods
 * Methods are tried in order of reliability
 * @param {string} containerText - Text content to search
 * @param {Element} detailContainer - DOM element to search
 * @returns {string|null} Bedspace code or null if not found
 */
function extractBedspace(containerText, detailContainer) {
    const methods = [
        // Method 1: Room/Bedspace pattern (most reliable)
        () => {
            const match = containerText.match(/Room\s+([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])\/([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i);
            if (match) {
                log('METHOD 1: Bedspace after slash:', match[2]);
                return match[2];
            }
        },
        
        // Method 2: Rez 360 section search
        () => {
            const rez360Section = containerText.match(/Rez 360[\s\S]*?(?=Activity|Related|$)/);
            if (rez360Section) {
                const match = rez360Section[0].match(CONFIG.RESIDENCE_PATTERN);
                if (match) {
                    log('METHOD 2: Bedspace in Rez 360:', match[0]);
                    return match[0];
                }
            }
        },
        
        // Method 3: Room Space field
        () => {
            const match = containerText.match(/Room Space[\s\S]*?([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i);
            if (match) {
                log('METHOD 3: Room Space field:', match[1]);
                return match[1];
            }
        },
        
        // Method 4: Pattern search (last resort - takes last match)
        () => {
            const matches = containerText.match(new RegExp(CONFIG.RESIDENCE_PATTERN.source, 'gi'));
            if (matches?.length > 0) {
                const lastMatch = matches[matches.length - 1];
                log('METHOD 4: Pattern search:', lastMatch);
                return lastMatch;
            }
        }
    ];
    
    // Try each method in order until one succeeds
    for (const method of methods) {
        const result = method();
        if (result) return result;
    }
    
    return null;
}

/**
 * Validates extracted student data against known patterns
 * @param {Object} data - Data object to validate
 * @returns {Object|null} Validated data or null if validation fails
 */
function validateStudentData(data) {
    const checks = {
        hasAllFields: data.fullName && data.studentNumber && data.roomSpace,
        validStudentNum: CONFIG.STUDENT_NUMBER_PATTERN.test(data.studentNumber),
        validBedspace: CONFIG.RESIDENCE_PATTERN.test(data.roomSpace),
        validName: data.fullName?.includes(',')
    };
    
    const isValid = Object.values(checks).every(Boolean);
    
    if (!isValid) {
        error('VALIDATION FAILED:', checks);
        return null;
    }
    
    log('Validation passed');
    
    // Cache validated data for future comparisons
    state.lastExtracted = {
        ...data,
        timestamp: Date.now()
    };
    
    return data;
}

// ============================================================================
// TIME FORMATTING
// ============================================================================

/**
 * Gets current time in 12-hour format
 * @returns {string} Formatted time (e.g., "2:34 pm")
 */
function getCurrentTime() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = now.getHours() >= 12 ? 'pm' : 'am';
    return `${hours}:${minutes} ${ampm}`;
}

/**
 * Gets formatted date and time for package labels
 * @returns {string} Formatted datetime (e.g., "01/23/2026 2:34p.m.")
 */
function getFormattedDateTime() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    const hours = now.getHours() % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = now.getHours() >= 12 ? 'p.m.' : 'a.m.';
    
    return `${month}/${day}/${year} ${hours}:${minutes}${ampm}`;
}

// ============================================================================
// LOG ENTRY GENERATION - PACKAGE LOGGING
// ============================================================================

/**
 * Generates a formatted package pickup log entry
 * Format: J.D (20321232) CLVN-349b 1 pkg @ 1:39 pm - A.B
 * @param {number} packageCount - Number of packages being logged
 * @returns {Object} Result object with success status and log entry or error
 */
function generateLogEntry(packageCount = 1) {
    try {
        const currentBreadcrumb = getCurrentBreadcrumb();
        
        if (!currentBreadcrumb) {
            return { 
                success: false, 
                error: 'No student profile detected' 
            };
        }
        
        const studentData = getStudentDataFromRez360();
        
        if (!studentData) {
            return { 
                success: false, 
                error: 'Data extraction failed. Check console for details.'
            };
        }
        
        // Verify extracted data matches current breadcrumb
        if (studentData.fullName !== currentBreadcrumb) {
            error('❌ DATA MISMATCH:', { breadcrumb: currentBreadcrumb, extracted: studentData.fullName });
            return {
                success: false,
                error: 'Profile data mismatch. Wait for page to load fully.'
            };
        }
        
        // Check cache validity to prevent stale data
        const cacheAge = Date.now() - (state.lastExtracted.timestamp || 0);
        if (state.lastExtracted.name && cacheAge < CONFIG.CACHE_DURATION) {
            const cacheValid = 
                state.lastExtracted.name === studentData.fullName &&
                state.lastExtracted.studentNumber === studentData.studentNumber &&
                state.lastExtracted.roomSpace === studentData.roomSpace;
            
            if (!cacheValid) {
                error('❌ CACHE MISMATCH:', { cached: state.lastExtracted, current: studentData, age: cacheAge });
                return {
                    success: false,
                    error: 'Stale data detected. Wait 2-3 seconds and retry.'
                };
            }
            log('✓ Cache validated');
        }
        
        const staffName = getStaffName();
        const initials = getInitials(studentData.fullName);
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        const time = getCurrentTime();
        
        // Format: J.D (20321232) CLVN-349b 1 pkg @ 1:39 pm - A.B
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
        log('Generated:', logEntry);
        
        return {
            success: true,
            logEntry,
            data: {
                initials,
                studentNumber: studentData.studentNumber,
                roomSpace: studentData.roomSpace,
                packageCount,
                time,
                fullName: studentData.fullName,
                staffInitials,
                staffName
            }
        };
    } catch (err) {
        error('Exception:', err);
        return { success: false, error: err.message };
    }
}

// ============================================================================
// KEY CODE EXTRACTION - LOCKOUT LOGGING
// ============================================================================

/**
 * Extracts key codes from the StarRez page
 * @returns {Array|null} Array of key codes or null if not found
 */
function extractKeyCodes() {
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    const containerText = detailContainer.innerText;
    
    // Look for "Key Code" section OR "LOANER" and extract alphanumeric codes
    const keyCodePattern = /(?:Key Code|LOANER.*?)[:\s]+([A-Z0-9]+(?:[,\s]+[A-Z0-9]+)*)/i;
    const match = containerText.match(keyCodePattern);
    
    if (!match) {
        log('No key codes found');
        return null;
    }
    
    // Split multiple key codes (comma or space separated)
    const codes = match[1]
        .split(/[,\s]+/)
        .map(c => c.trim())
        .filter(c => c.length > 0);
    
    log('Found key codes:', codes);
    return codes;
}

/**
 * Generates a formatted lockout key log entry
 * Format: F.L (12345678) ROOM-123a KC: CODE1, CODE2
 * @returns {Object} Result object with success status and log entry or error
 */
function generateLockoutEntry() {
    try {
        const currentBreadcrumb = getCurrentBreadcrumb();
        
        if (!currentBreadcrumb) {
            return { 
                success: false, 
                error: 'No student profile detected' 
            };
        }
        
        const studentData = getStudentDataFromRez360();
        
        if (!studentData) {
            return { 
                success: false, 
                error: 'Data extraction failed. Check console for details.'
            };
        }
        
        // Verify data matches breadcrumb
        if (studentData.fullName !== currentBreadcrumb) {
            error('❌ DATA MISMATCH:', { breadcrumb: currentBreadcrumb, extracted: studentData.fullName });
            return {
                success: false,
                error: 'Profile data mismatch. Wait for page to load fully.'
            };
        }
        
        // Check cache validity
        const cacheAge = Date.now() - (state.lastExtracted.timestamp || 0);
        if (state.lastExtracted.name && cacheAge < CONFIG.CACHE_DURATION) {
            const cacheValid = 
                state.lastExtracted.name === studentData.fullName &&
                state.lastExtracted.studentNumber === studentData.studentNumber &&
                state.lastExtracted.roomSpace === studentData.roomSpace;
            
            if (!cacheValid) {
                error('❌ CACHE MISMATCH:', { cached: state.lastExtracted, current: studentData, age: cacheAge });
                return {
                    success: false,
                    error: 'Stale data detected. Wait 2-3 seconds and retry.'
                };
            }
            log('Cache validated');
        }
        
        const keyCodes = extractKeyCodes();
        
        if (!keyCodes || keyCodes.length === 0) {
            return {
                success: false,
                error: 'No key codes found on this page'
            };
        }
        
        const initials = getInitials(studentData.fullName);
        
        // Format: F.L (12345678) ROOM-123a KC: CODE1, CODE2
        const keyCodesStr = keyCodes.join(', ');
        const lockoutEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} KC: ${keyCodesStr}`;
        
        log('Generated lockout entry:', lockoutEntry);
        
        return {
            success: true,
            logEntry: lockoutEntry,
            data: {
                initials,
                studentNumber: studentData.studentNumber,
                roomSpace: studentData.roomSpace,
                keyCodes,
                fullName: studentData.fullName
            }
        };
    } catch (err) {
        error('Exception in generateLockoutEntry:', err);
        return { success: false, error: err.message };
    }
}

// ============================================================================
// PACKAGE LABEL GENERATION
// ============================================================================

/**
 * Generates a formatted package label for printing
 * Format:
 * 01/23/2026 02:34p.m.
 * 20990921
 * Anay Baid
 * WOS-253a
 * FDA Name: F.T
 * @returns {Object} Result object with success status and label text or error
 */
function generatePackageLabel() {
    try {
        const currentBreadcrumb = getCurrentBreadcrumb();
        
        if (!currentBreadcrumb) {
            return { 
                success: false, 
                error: 'No student profile detected' 
            };
        }
        
        const studentData = getStudentDataFromRez360();
        
        if (!studentData) {
            return { 
                success: false, 
                error: 'Data extraction failed. Check console for details.'
            };
        }
        
        // Verify data matches breadcrumb
        if (studentData.fullName !== currentBreadcrumb) {
            error('❌ DATA MISMATCH:', { breadcrumb: currentBreadcrumb, extracted: studentData.fullName });
            return {
                success: false,
                error: 'Profile data mismatch. Wait for page to load fully.'
            };
        }
        
        // Check cache validity
        const cacheAge = Date.now() - (state.lastExtracted.timestamp || 0);
        if (state.lastExtracted.name && cacheAge < CONFIG.CACHE_DURATION) {
            const cacheValid = 
                state.lastExtracted.name === studentData.fullName &&
                state.lastExtracted.studentNumber === studentData.studentNumber &&
                state.lastExtracted.roomSpace === studentData.roomSpace;
            
            if (!cacheValid) {
                error('❌ CACHE MISMATCH:', { cached: state.lastExtracted, current: studentData, age: cacheAge });
                return {
                    success: false,
                    error: 'Stale data detected. Wait 2-3 seconds and retry.'
                };
            }
            log('✓ Cache validated');
        }
        
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'X.X';
        const dateTime = getFormattedDateTime();
        
        // Convert "LastName, FirstName" to "FirstName LastName" for readability
        let displayName = studentData.fullName;
        if (displayName.includes(',')) {
            const [lastName, firstName] = displayName.split(',').map(p => p.trim());
            displayName = `${firstName} ${lastName}`;
        }
        
        // Multi-line format for printing
        const labelText = `${dateTime}\n${studentData.studentNumber}\n${displayName}\n${studentData.roomSpace}\nFDA Name: ${staffInitials}`;
        
        log('Generated package label:', labelText);
        
        return {
            success: true,
            logEntry: labelText,
            data: {
                dateTime,
                studentNumber: studentData.studentNumber,
                displayName,
                roomSpace: studentData.roomSpace,
                staffInitials,
                staffName,
                fullName: studentData.fullName
            }
        };
    } catch (err) {
        error('Exception in generatePackageLabel:', err);
        return { success: false, error: err.message };
    }
}

// ============================================================================
// CLIPBOARD OPERATIONS
// ============================================================================

/**
 * Copies text to clipboard using modern Clipboard API
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        log('Copied:', text);
        return true;
    } catch (err) {
        error('Clipboard failed:', err);
        return false;
    }
}

// ============================================================================
// UI COMPONENTS
// ============================================================================

/**
 * Creates a styled button with consistent appearance
 * @param {string} text - Button text
 * @param {string} gradient - CSS gradient for button background
 * @returns {HTMLButtonElement} Styled button element
 */
function createStyledButton(text, gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)') {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.cssText = `
        margin-left: 10px;
        padding: 8px 16px;
        background: ${gradient};
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        transition: all 0.2s ease;
    `;
    
    // Hover effects
    button.addEventListener('mouseenter', () => {
        button.style.transform = 'translateY(-2px)';
        button.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
    });
    
    button.addEventListener('mouseleave', () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
    });
    
    return button;
}

/**
 * Shows a preview popup of the copied text
 * @param {string} text - Text that was copied
 * @param {Object} data - Additional data to display
 */
function showPreview(text, data) {
    // Remove any existing preview
    const existing = document.getElementById('log-preview-popup');
    existing?.remove();
    
    const preview = document.createElement('div');
    preview.id = 'log-preview-popup';
    preview.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border: 2px solid #667eea;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 500px;
        font-family: monospace;
        font-size: 13px;
        animation: slideIn 0.3s ease;
    `;
    
    const staffInfo = data.staffName 
        ? `<div style="font-size: 11px; color: #999; margin-bottom: 4px;">Logged by: ${data.staffName}</div>` 
        : '';
    
    // Different debug info based on data type
    let debugInfo = '';
    if (data.keyCodes) {
        debugInfo = `<div style="font-size: 10px; color: #ccc; margin-top: 8px;">Student: ${data.fullName}<br/>Room: ${data.roomSpace}<br/>Keys: ${data.keyCodes.join(', ')}</div>`;
    } else if (data.displayName) {
        debugInfo = `<div style="font-size: 10px; color: #ccc; margin-top: 8px;">Student: ${data.fullName}<br/>Display: ${data.displayName}</div>`;
    } else {
        debugInfo = `<div style="font-size: 10px; color: #ccc; margin-top: 8px;">Student: ${data.fullName}<br/>Room: ${data.roomSpace}</div>`;
    }
    
    // Preserve line breaks for multi-line labels
    const formattedText = text.replace(/\n/g, '<br>');
    
    preview.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #667eea;">Copied to Clipboard</div>
        ${staffInfo}
        <div style="background: #f7f7f7; padding: 8px; border-radius: 4px; word-break: break-all; font-weight: 600;">${formattedText}</div>
        ${debugInfo}
    `;
    
    document.body.appendChild(preview);
    
    // Auto-remove after configured duration
    setTimeout(() => {
        preview.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => preview.remove(), 300);
    }, CONFIG.PREVIEW_DURATION);
}

// ============================================================================
// BUTTON CREATION AND EVENT HANDLING
// ============================================================================

/**
 * Generic button click handler for all button types
 * @param {HTMLButtonElement} button - Button element that was clicked
 * @param {number} packageCount - Number of packages (for package logs)
 * @param {string} originalText - Original button text to restore
 * @param {string} successGradient - Gradient to show on success
 * @param {string} actionType - Type of action: 'package', 'lockout', or 'label'
 */
async function handleButtonClick(button, packageCount, originalText, successGradient, actionType = 'package') {
    if (button.disabled) return;
    
    let result;
    if (actionType === 'lockout') {
        result = generateLockoutEntry();
    } else if (actionType === 'label') {
        result = generatePackageLabel();
    } else {
        result = generateLogEntry(packageCount);
    }
    
    if (result.success) {
        const copied = await copyToClipboard(result.logEntry);
        
        if (copied) {
            button.textContent = 'Copied!';
            button.style.background = successGradient;
            showPreview(result.logEntry, result.data);
            
            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = button.dataset.originalGradient;
            }, 2000);
        }
    } else {
        alert('❌ Error: ' + result.error);
    }
}

/**
 * Enables a button after a delay to ensure DOM stability
 * @param {HTMLButtonElement} button - Button to enable
 * @param {string} originalText - Text to restore after loading
 */
function enableButtonAfterDelay(button, originalText) {
    setTimeout(() => {
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
        button.textContent = originalText;
    }, CONFIG.BUTTON_ENABLE_DELAY);
}

/**
 * Creates master button for logging multiple packages at once
 * Only appears when 2+ packages are detected
 * @param {number} packageCount - Total number of packages
 */
function createMasterButton(packageCount) {
    // Find element showing package count (e.g., "5 Parcels")
    const parcelCountElement = Array.from(document.querySelectorAll('span')).find(span => 
        /^\d+\s+Parcel[s]?$/i.test(span.textContent.trim()) && span.children.length === 0
    );
    
    if (!parcelCountElement || document.getElementById('package-log-master-btn')) {
        return;
    }
    
    const gradient = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
    const successGradient = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
    const buttonText = `Copy ${packageCount} pkgs`;
    
    const button = createStyledButton('Loading...', gradient);
    button.id = 'package-log-master-btn';
    button.style.marginLeft = '15px';
    button.style.verticalAlign = 'middle';
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';
    button.dataset.originalGradient = gradient;
    
    enableButtonAfterDelay(button, buttonText);
    
    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleButtonClick(button, packageCount, buttonText, successGradient, 'package');
    });
    
    parcelCountElement.parentNode.insertBefore(button, parcelCountElement.nextSibling);
    log(`Master button created for ${packageCount} packages`);
}

/**
 * Creates individual "Copy Log" buttons next to each Issue button
 * Allows logging packages one at a time
 * @returns {number} Number of Issue buttons found
 */
function createIndividualButtons() {
    // Find all Issue buttons on the page
    const issueButtons = Array.from(document.querySelectorAll('button, input[type="button"], a.button, a[class*="button"]'))
        .filter(btn => {
            const text = btn.textContent.toLowerCase();
            return text.includes('issue') && !text.includes('reissue');
        });
    
    if (issueButtons.length === 0) {
        log('No Issue buttons found');
        return 0;
    }
    
    const gradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    const successGradient = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
    const buttonText = 'Copy Log';
    
    issueButtons.forEach((issueBtn, index) => {
        const buttonId = `package-log-btn-${index}`;
        if (document.getElementById(buttonId)) return; // Skip if already exists
        
        const button = createStyledButton('Loading...', gradient);
        button.id = buttonId;
        button.disabled = true;
        button.style.opacity = '0.6';
        button.style.cursor = 'not-allowed';
        button.dataset.originalGradient = gradient;
        
        enableButtonAfterDelay(button, buttonText);
        
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleButtonClick(button, 1, buttonText, successGradient, 'package');
        });
        
        issueBtn.parentNode.insertBefore(button, issueBtn.nextSibling);
    });
    
    log('Individual buttons created');
    return issueButtons.length;
}

/**
 * Creates lockout button when key codes are detected on the page
 * Used for logging key lockouts with key codes
 */
function createLockoutButton() {
    const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
    
    // UPDATED CHECK: Look for "KEYS", "LOANER", or "Key Code"
    const hasKeyCodes = /Key Code|KEYS|LOANER/i.test(detailContainer.innerText);
    
    if (!hasKeyCodes) {
        log('No key codes detected, skipping lockout button');
        return;
    }
    
    if (document.getElementById('lockout-log-btn')) {
        return; // Already exists
    }
    
    // Find all elements containing the target text
    const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        // Ignore invisible elements
        if (el.offsetParent === null) return false;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;

        const text = el.textContent;
        // Check for specific keywords
        return (/Key Code|KEYS|LOANER/i.test(text)) && text.length < 100;
    });
    
    if (candidates.length === 0) {
        log('Could not find suitable location for lockout button');
        return;
    }

    // SORT BY LENGTH: Use the element with the least amount of text.
    // This ensures we grab the specific label "KEYS" (length 4) 
    // instead of the parent container "KEYS ... LOANER ... Notes" (length 50+)
    candidates.sort((a, b) => a.textContent.length - b.textContent.length);
    const bestTarget = candidates[0];
    
    log('Attaching button to:', bestTarget.tagName, bestTarget.textContent);

    const gradient = 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)';
    const successGradient = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
    const buttonText = 'Copy Lockout';
    
    const button = createStyledButton('Loading...', gradient);
    button.id = 'lockout-log-btn';
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';
    button.dataset.originalGradient = gradient;
    
    enableButtonAfterDelay(button, buttonText);
    
    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleButtonClick(button, 1, buttonText, successGradient, 'lockout');
    });
    
    // Append INSIDE the element (next to the text) instead of after it
    // This prevents it from being pushed to a new line or outside the box
    bestTarget.appendChild(button);
    
    log('Lockout button created');
}

/**
 * Creates package label button at top right near Entry Actions button
 * Always visible on student profiles for printing labels
 */
function createPackageLabelButton() {
    const existingButton = document.getElementById('package-label-btn');
    if (existingButton) {
        log('Print Label button already exists, skipping');
        return;
    }
    
    log('Attempting to create Print Label button...');
    
    // Strategy 1: Find "Entry Actions" button
    let entryActionsBtn = Array.from(document.querySelectorAll('button')).find(el => 
        /Entry Actions/i.test(el.textContent) && el.textContent.length < 30
    );
    
    // Strategy 2: Find the "New" dropdown button
    if (!entryActionsBtn) {
        entryActionsBtn = Array.from(document.querySelectorAll('button')).find(el => {
            const text = el.textContent.trim();
            return text === 'New' || text.startsWith('New');
        });
    }
    
    // Strategy 3: Find any button in the top header area
    if (!entryActionsBtn) {
        const topButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
            const rect = btn.getBoundingClientRect();
            return rect.top < 150 && rect.right > window.innerWidth - 500;
        });
        if (topButtons.length > 0) {
            entryActionsBtn = topButtons[0];
            log('Using top-right button as anchor');
        }
    }
    
    let targetContainer = null;
    if (entryActionsBtn) {
        targetContainer = entryActionsBtn.parentElement;
        log('Found button container');
    } else {
        // Fallback: breadcrumb area
        const breadcrumb = document.querySelector('habitat-header-breadcrumb-item');
        if (breadcrumb) {
            targetContainer = breadcrumb.parentElement?.parentElement;
            log('Using breadcrumb container');
        }
    }
    
    if (!targetContainer) {
        error('Could not find location for Print Label button');
        return;
    }
    
    const gradient = 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
    const successGradient = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
    const buttonText = 'Print Label';
    
    const button = createStyledButton('Loading...', gradient);
    button.id = 'package-label-btn';
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';
    button.dataset.originalGradient = gradient;
    
    enableButtonAfterDelay(button, buttonText);
    
    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleButtonClick(button, 1, buttonText, successGradient, 'label');
    });
    
    // Insert before Entry Actions or append
    if (entryActionsBtn) {
        entryActionsBtn.parentNode.insertBefore(button, entryActionsBtn);
    } else {
        targetContainer.appendChild(button);
    }
    
    log('Print Label button created successfully');
}

/**
 * Main function to create all appropriate buttons
 * Called whenever page initializes or profile changes
 */
function createLogButtons() {
    const packageCount = createIndividualButtons();
    
    if (packageCount >= 2) {
        createMasterButton(packageCount);
    }
    
    createLockoutButton();
    createPackageLabelButton();
}

// ============================================================================
// STATE MANAGEMENT AND CLEANUP
// ============================================================================

/**
 * Clears all buttons and resets state
 * Called when navigating to a new profile or when profile content changes
 */
function clearOldButtons() {
    // Remove all button types
    document.querySelectorAll('[id^="package-log-btn-"]').forEach(btn => btn.remove());
    document.getElementById('package-log-master-btn')?.remove();
    document.getElementById('lockout-log-btn')?.remove();
    document.getElementById('package-label-btn')?.remove();
    
    // Clear cached extraction data
    state.lastExtracted = {
        name: null,
        studentNumber: null,
        roomSpace: null,
        timestamp: null
    };
    
    log('Cleared old buttons and cache');
}

// ============================================================================
// INITIALIZATION AND CHANGE DETECTION
// ============================================================================

/**
 * Main initialization function
 * Handles page load, profile changes, and button creation
 */
function initialize() {
    clearTimer('init');
    
    state.timers.init = setTimeout(() => {
        const currentBreadcrumb = getCurrentBreadcrumb();
        
        // CRITICAL: Detect profile changes and force cleanup
        const profileChanged = hasProfileChanged();
        const breadcrumbChanged = currentBreadcrumb !== state.lastBreadcrumb;
        
        if (breadcrumbChanged || profileChanged) {
            log('PROFILE CHANGE DETECTED - CLEARING BUFFER');
            log('  Breadcrumb changed:', breadcrumbChanged, `(${state.lastBreadcrumb} → ${currentBreadcrumb})`);
            log('  Content changed:', profileChanged);
            
            // Force immediate cleanup
            clearOldButtons();
            state.lastBreadcrumb = currentBreadcrumb;
            state.validationAttempts = 0;
            
            // Clear profile hash to force re-check on next cycle
            state.lastProfileHash = null;
        }
        
        if (!currentBreadcrumb) {
            log('No student profile detected');
            return;
        }
        
        // Wait for EntryID section to ensure Rez 360 data is loaded
        const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
        const hasEntryId = container.innerText.includes('EntryID:');
        
        if (!hasEntryId) {
            state.validationAttempts++;
            if (state.validationAttempts < CONFIG.MAX_VALIDATION_ATTEMPTS) {
                log(`⏳ Waiting for data... (${state.validationAttempts}/${CONFIG.MAX_VALIDATION_ATTEMPTS})`);
                setTimeout(initialize, 1000);
                return;
            }
            log('⚠️ Gave up waiting for EntryID');
        } else {
            log('EntryID found');
            state.validationAttempts = 0;
        }
        
        log('Initializing for:', currentBreadcrumb);
        createLogButtons();
    }, CONFIG.INIT_DEBOUNCE);
}

// ============================================================================
// STARTUP AND EVENT LISTENERS
// ============================================================================

// Add CSS animations for preview popup
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

// Watch for DOM changes (navigation, AJAX updates)
const observer = new MutationObserver(() => {
    clearTimer('observer');
    state.timers.observer = setTimeout(initialize, CONFIG.OBSERVER_DEBOUNCE);
});

observer.observe(document.body, { 
    childList: true, 
    subtree: true 
});

log('StarRez Package Logger v2.2 loaded');

// ============================================================================
// END OF SCRIPT
// ============================================================================
