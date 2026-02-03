// ============================================================================
// StarRez Package Logger v3.0 - PRODUCTION READY
// ============================================================================
// PURPOSE: Automates logging for UWP Front Desk operations in StarRez
// 
// FEATURES:
// 1. Package Log Buttons - Generate formatted package pickup logs
// 2. Lockout Log Button - Generate formatted lockout key logs
// 3. Print Label Button - Generate formatted package labels for printing
//
// IMPROVEMENTS in v3.0:
// - Complete SPA navigation handling (no refresh needed)
// - Unified button color scheme
// - Smarter profile detection and caching
// - Faster button injection (50ms vs 200ms)
// - Better error recovery and logging
// - Production-grade state management
//
// AUTHOR: Front Desk Automation Team / Anay Baid
// LAST UPDATED: February 2026
// ============================================================================

const CONFIG = {
    DEBUG: true,
    VERSION: '3.0.0',
    
    // Pattern matching
    RESIDENCE_PATTERN: /[A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z]/i,
    STUDENT_NUMBER_PATTERN: /^\d{8}$/,
    
    // Timing configuration (optimized for production)
    CACHE_DURATION: 15000,           // 15s cache for student data
    INIT_DEBOUNCE: 150,              // Faster initial check
    OBSERVER_DEBOUNCE: 200,          // Faster observer response
    BUTTON_ENABLE_DELAY: 50,         // Much faster button enable
    PREVIEW_DURATION: 3500,          // Slightly shorter preview
    MAX_VALIDATION_ATTEMPTS: 15,
    PROFILE_SWITCH_DELAY: 100,       // Quick profile switch detection
    
    // Button styling - Unified color scheme
    COLORS: {
        primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',      // Purple - Package buttons
        secondary: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',    // Pink - Multi-package
        lockout: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',      // Coral/Yellow - Lockout
        label: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',        // Blue - Label
        success: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',      // Green - Success
        disabled: '#cccccc'
    }
};

// ============================================================================
// STATE MANAGEMENT - Enhanced for SPA navigation
// ============================================================================

const state = {
    // Student data cache
    currentStudent: {
        fullName: null,
        studentNumber: null,
        roomSpace: null,
        timestamp: null,
        breadcrumb: null
    },
    
    // Previous student for comparison
    previousStudent: {
        studentNumber: null,
        breadcrumb: null
    },
    
    // UI state
    buttons: new Map(), // Track all created buttons by ID
    validationAttempts: 0,
    isInitializing: false,
    
    // Timers
    timers: {
        init: null,
        observer: null,
        profileSwitch: null
    },
    
    // Performance tracking
    performance: {
        lastInitTime: 0,
        buttonCreationCount: 0,
        errorCount: 0
    }
};

// ============================================================================
// UTILITY FUNCTIONS - Enhanced logging
// ============================================================================

const log = (...args) => {
    if (CONFIG.DEBUG) {
        console.log(`[PKG-LOGGER v${CONFIG.VERSION}]`, new Date().toLocaleTimeString(), ...args);
    }
};

const error = (...args) => {
    console.error(`[PKG-LOGGER ERROR v${CONFIG.VERSION}]`, new Date().toLocaleTimeString(), ...args);
    state.performance.errorCount++;
};

const clearTimer = (timerName) => {
    if (state.timers[timerName]) {
        clearTimeout(state.timers[timerName]);
        state.timers[timerName] = null;
    }
};

const clearAllTimers = () => {
    Object.keys(state.timers).forEach(clearTimer);
};

// ============================================================================
// DATA EXTRACTION - Improved reliability
// ============================================================================

function getStaffName() {
    try {
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const match = script.textContent.match(/full_name:\s*`([^`]+)`/);
            if (match?.[1]) {
                log('Staff name extracted:', match[1]);
                return match[1];
            }
        }
        log('Staff name not found in scripts');
        return null;
    } catch (err) {
        error('getStaffName error:', err);
        return null;
    }
}

function getInitials(fullName) {
    if (!fullName) return 'XX';
    
    try {
        // Handle "LastName, FirstName" format
        if (fullName.includes(',')) {
            const [lastName, firstName = ''] = fullName.split(',').map(p => p.trim());
            const getInitials = (name) => name.split(/\s+/).filter(n => n.length > 0).map(n => n[0].toUpperCase()).join('');
            const result = `${getInitials(firstName)}.${getInitials(lastName)}`;
            return result || 'XX';
        }
        
        // Handle "FirstName LastName" format
        const parts = fullName.split(/\s+/).filter(p => p.length > 0);
        if (parts.length >= 2) {
            const firstInitials = parts.slice(0, -1).map(n => n[0].toUpperCase()).join('');
            const lastInitial = parts[parts.length - 1][0].toUpperCase();
            return `${firstInitials}.${lastInitial}`;
        }
        
        // Fallback for single name
        return parts.map(p => p[0]).join('').toUpperCase() + '.X';
    } catch (err) {
        error('getInitials error:', err);
        return 'XX';
    }
}

function getCurrentBreadcrumb() {
    try {
        const breadcrumbs = document.querySelectorAll('habitat-header-breadcrumb-item');
        for (const crumb of breadcrumbs) {
            const text = crumb.textContent.trim();
            // Student names typically include a comma and don't include navigation words
            if (text.includes(',') && !text.includes('Dashboard') && !text.includes('Desk')) {
                return text;
            }
        }
        return null;
    } catch (err) {
        error('getCurrentBreadcrumb error:', err);
        return null;
    }
}

// ============================================================================
// STUDENT DATA LOGIC - Enhanced with better caching
// ============================================================================

function isStudentDataCached() {
    if (!state.currentStudent.timestamp) return false;
    const age = Date.now() - state.currentStudent.timestamp;
    return age < CONFIG.CACHE_DURATION;
}

function getStudentDataFromRez360() {
    try {
        // Check cache first
        if (isStudentDataCached()) {
            log('Using cached student data');
            return { ...state.currentStudent };
        }
        
        const data = {};
        const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
        let containerText = detailContainer.innerText;
        
        // Optimize text extraction - start from EntryID if present
        const entryIdIndex = containerText.indexOf('EntryID:');
        if (entryIdIndex !== -1) {
            containerText = containerText.substring(entryIdIndex);
        }
        
        // Extract full name from breadcrumb
        data.fullName = getCurrentBreadcrumb();
        if (!data.fullName) {
            log('No student name found in breadcrumb');
            return null;
        }
        
        // Extract student number
        const studentNumMatch = containerText.match(/Student Number\s+(\d{8})/);
        if (!studentNumMatch) {
            log('No student number found');
            return null;
        }
        data.studentNumber = studentNumMatch[1];
        
        // Extract room/bedspace
        data.roomSpace = extractBedspace(containerText);
        if (!data.roomSpace) {
            log('No room space found');
            return null;
        }
        
        // Validate and cache
        return validateAndCacheStudentData(data);
    } catch (err) {
        error('getStudentDataFromRez360 error:', err);
        return null;
    }
}

function extractBedspace(containerText) {
    try {
        const methods = [
            // Method 1: Room/Bedspace format (most reliable)
            () => {
                const match = containerText.match(/Room\s+([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])\/([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i);
                return match ? match[2] : null;
            },
            // Method 2: Rez 360 section
            () => {
                const rez360Section = containerText.match(/Rez 360[\s\S]*?(?=Activity|Related|$)/);
                if (rez360Section) {
                    const match = rez360Section[0].match(CONFIG.RESIDENCE_PATTERN);
                    return match ? match[0] : null;
                }
                return null;
            },
            // Method 3: Room Space label
            () => {
                const match = containerText.match(/Room Space[\s\S]*?([A-Z0-9]+[NS]?-(?:[A-Z0-9]+-)?\d+[a-z])/i);
                return match ? match[1] : null;
            },
            // Method 4: General residence pattern (last resort)
            () => {
                const match = containerText.match(CONFIG.RESIDENCE_PATTERN);
                return match ? match[0] : null;
            }
        ];
        
        for (let i = 0; i < methods.length; i++) {
            const result = methods[i]();
            if (result) {
                log(`Bedspace found using method ${i + 1}:`, result);
                return result;
            }
        }
        
        return null;
    } catch (err) {
        error('extractBedspace error:', err);
        return null;
    }
}

function validateAndCacheStudentData(data) {
    try {
        if (
            data.fullName &&
            CONFIG.STUDENT_NUMBER_PATTERN.test(data.studentNumber) &&
            CONFIG.RESIDENCE_PATTERN.test(data.roomSpace)
        ) {
            // Update cache
            state.currentStudent = {
                ...data,
                timestamp: Date.now(),
                breadcrumb: getCurrentBreadcrumb()
            };
            
            log('Student data validated and cached:', {
                name: data.fullName,
                id: data.studentNumber,
                room: data.roomSpace
            });
            
            return data;
        }
        
        log('Student data validation failed:', data);
        return null;
    } catch (err) {
        error('validateAndCacheStudentData error:', err);
        return null;
    }
}

function getCurrentTime() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${now.getHours() >= 12 ? 'pm' : 'am'}`;
}

function getFormattedDateTime() {
    const now = new Date();
    const hours = now.getHours() % 12 || 12;
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = now.getHours() >= 12 ? 'p.m.' : 'a.m.';
    return `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${hours}:${minutes}${ampm}`;
}

// ============================================================================
// CORE LOG GENERATORS - Enhanced error handling
// ============================================================================

function generateLogEntry(packageCount = 1) {
    try {
        const studentData = getStudentDataFromRez360();
        if (!studentData) {
            return { success: false, error: 'Student data not found or incomplete' };
        }
        
        const staffName = getStaffName();
        const initials = getInitials(studentData.fullName);
        const staffInitials = staffName ? getInitials(staffName) : 'XX';
        const time = getCurrentTime();
        
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} ${packageCount} pkg${packageCount > 1 ? 's' : ''} @ ${time} - ${staffInitials}`;
        
        log('Package log generated:', logEntry);
        
        return {
            success: true,
            logEntry,
            data: { ...studentData, staffInitials, staffName }
        };
    } catch (err) {
        error('generateLogEntry error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * STRICT KEY EXTRACTION v3.0
 * Enhanced filtering and detection logic
 */
function extractKeyCodes(studentName, studentID) {
    try {
        const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
        const text = detailContainer.innerText;
        
        // Regex finds "Label : CODE" patterns
        const allMatches = Array.from(text.matchAll(/(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\r\n]*:\s*([A-Z0-9]+)/gi));
        
        // Detection for "Report Mode" (multiple students visible)
        const isReportMode = /Entry Name.*Student Number/i.test(text) || 
                            /Loaner Keys Report/i.test(text) || 
                            allMatches.length > 6;

        if (isReportMode && studentID) {
            log(`Report Mode detected - Filtering for Student ID: ${studentID}`);
            
            // STRICT: Look for [StudentID] ... [Key] : [Code] within 300 chars
            const strictRegex = new RegExp(
                `${studentID}[\\s\\S]{0,300}?(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\\r\\n]*:\\s*([A-Z0-9]+)`,
                "gi"
            );
            const strictMatches = Array.from(text.matchAll(strictRegex));
            
            if (strictMatches.length > 0) {
                return extractUniqueCodes(strictMatches, studentID);
            }
            
            // Fallback to name-based search
            if (studentName) {
                const escapedName = studentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const nameRegex = new RegExp(
                    `${escapedName}[\\s\\S]{0,300}?(?:Bedroom|Floor|Mail|Unit|Key|LOANER)[^:\\r\\n]*:\\s*([A-Z0-9]+)`,
                    "gi"
                );
                const nameMatches = Array.from(text.matchAll(nameRegex));
                
                if (nameMatches.length > 0) {
                    return extractUniqueCodes(nameMatches, studentID);
                }
            }
            
            log('No keys found in Report Mode for this student');
            return null;
        }
        
        // Normal mode - single profile
        return extractUniqueCodes(allMatches, studentID);
    } catch (err) {
        error('extractKeyCodes error:', err);
        return null;
    }
}

function extractUniqueCodes(matches, studentID) {
    if (!matches || matches.length === 0) return null;
    
    const uniqueCodes = new Set();
    matches.forEach(m => {
        const code = m[1].trim();
        // FILTER: Length > 2, No lowercase (emails), Not Student ID, Not common false positives
        if (
            code.length > 2 && 
            code.length < 20 && // Reasonable max length
            !/[a-z]/.test(code) && 
            code !== studentID &&
            !code.includes('@') // Extra email protection
        ) {
            uniqueCodes.add(code);
        }
    });
    
    const result = Array.from(uniqueCodes);
    log(`Extracted ${result.length} unique key codes:`, result);
    return result.length > 0 ? result : null;
}

function generateLockoutEntry() {
    try {
        const studentData = getStudentDataFromRez360();
        if (!studentData) {
            return { success: false, error: 'Student data not found or incomplete' };
        }
        
        const keyCodes = extractKeyCodes(studentData.fullName, studentData.studentNumber);
        if (!keyCodes || keyCodes.length === 0) {
            return { success: false, error: 'No Loaner Keys found for this student' };
        }
        
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'XX';
        const initials = getInitials(studentData.fullName);
        
        // Format with semicolon separator
        const logEntry = `${initials} (${studentData.studentNumber}) ${studentData.roomSpace} KC: ${keyCodes.join(', ')}; [Fill in Reason] - ${staffInitials}`;
        
        log('Lockout log generated:', logEntry);
        
        return {
            success: true,
            logEntry,
            data: { ...studentData, keyCodes, staffInitials, staffName }
        };
    } catch (err) {
        error('generateLockoutEntry error:', err);
        return { success: false, error: err.message };
    }
}

function generatePackageLabel() {
    try {
        const studentData = getStudentDataFromRez360();
        if (!studentData) {
            return { success: false, error: 'Student data not found or incomplete' };
        }
        
        const staffName = getStaffName();
        const staffInitials = staffName ? getInitials(staffName) : 'XX';
        const dateTime = getFormattedDateTime();
        
        // Format name as "FirstName LastName"
        let displayName = studentData.fullName;
        if (displayName.includes(',')) {
            const [lastName, firstName] = displayName.split(',').map(p => p.trim());
            displayName = `${firstName} ${lastName}`;
        }
        
        const labelText = `${dateTime}\n${studentData.studentNumber}\n${displayName}\n${studentData.roomSpace}\nFDA: ${staffInitials}`;
        
        log('Package label generated');
        
        return {
            success: true,
            logEntry: labelText,
            data: { ...studentData, dateTime, staffInitials, staffName }
        };
    } catch (err) {
        error('generatePackageLabel error:', err);
        return { success: false, error: err.message };
    }
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        log('Text copied to clipboard');
        return true;
    } catch (err) {
        error('copyToClipboard error:', err);
        return false;
    }
}

// ============================================================================
// UI COMPONENTS & BUTTONS - Unified styling
// ============================================================================

function createStyledButton(text, colorKey = 'primary') {
    const button = document.createElement('button');
    button.textContent = text;
    
    const gradient = CONFIG.COLORS[colorKey] || CONFIG.COLORS.primary;
    
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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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

function showPreview(text, data) {
    // Remove existing preview
    const existing = document.getElementById('log-preview-popup');
    if (existing) existing.remove();
    
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
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: slideIn 0.3s ease;
    `;
    
    let debugInfo = '';
    if (data.keyCodes) {
        debugInfo = `Student: ${data.fullName}<br/>Keys: ${data.keyCodes.join(', ')}`;
    } else {
        debugInfo = `Student: ${data.fullName}<br/>Room: ${data.roomSpace}`;
    }

    preview.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #667eea; font-size: 14px;">
            ✓ Copied to Clipboard
        </div>
        <div style="font-size: 11px; color: #999; margin-bottom: 8px;">
            Logged by: ${data.staffName || 'Unknown Staff'}
        </div>
        <div style="background: #f7f7f7; padding: 10px; border-radius: 4px; word-break: break-all; font-weight: 600; font-size: 13px; font-family: 'Courier New', monospace;">
            ${text.replace(/\n/g, '<br>')}
        </div>
        <div style="font-size: 10px; color: #aaa; margin-top: 8px; line-height: 1.4;">
            ${debugInfo}
        </div>
    `;
    
    document.body.appendChild(preview);
    
    setTimeout(() => {
        preview.remove();
    }, CONFIG.PREVIEW_DURATION);
}

async function handleButtonClick(button, count, originalText, colorKey, type) {
    if (button.disabled) return;
    
    try {
        let result;
        
        if (type === 'lockout') {
            result = generateLockoutEntry();
        } else if (type === 'label') {
            result = generatePackageLabel();
        } else {
            result = generateLogEntry(count);
        }
        
        if (result.success) {
            const copied = await copyToClipboard(result.logEntry);
            
            if (copied) {
                // Success feedback
                button.textContent = '✓ Copied!';
                button.style.background = CONFIG.COLORS.success;
                
                showPreview(result.logEntry, result.data);
                
                // Reset button after delay
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = CONFIG.COLORS[colorKey];
                }, 2000);
            } else {
                throw new Error('Failed to copy to clipboard');
            }
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        error('handleButtonClick error:', err);
        alert(`Error: ${err.message || 'Failed to generate log entry'}`);
    }
}

// ============================================================================
// BUTTON CREATION LOGIC - Enhanced with better detection
// ============================================================================

function createLockoutButton(retryCount = 0) {
    try {
        const detailContainer = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
        
        // 1. Verify we're on a student profile
        const isProfile = /EntryID:|Rez 360/i.test(detailContainer.innerText);
        if (!isProfile) {
            log('Not on a student profile - skipping lockout button');
            return;
        }

        // 2. Prevent duplicate buttons
        if (document.getElementById('lockout-log-btn')) {
            log('Lockout button already exists');
            return;
        }

        // 3. Find anchor point - look for Keys section
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.offsetParent === null || ['SCRIPT', 'STYLE'].includes(el.tagName)) return false;
            
            const text = el.textContent;
            return (
                /Key Code|KEYS|LOANER/i.test(text) &&
                text.length < 150 &&
                text.length > 2
            );
        });

        if (candidates.length === 0) {
            // Retry if keys section not loaded
            if (retryCount < 5) {
                log(`Keys section not found, retrying... (${retryCount + 1}/5)`);
                setTimeout(() => createLockoutButton(retryCount + 1), 500);
            } else {
                log('Keys section not found after 5 retries - giving up');
            }
            return;
        }
        
        // Sort by text length to find most specific label
        candidates.sort((a, b) => a.textContent.length - b.textContent.length);
        const anchor = candidates[0];

        // Create button
        const button = createStyledButton('Loading...', 'lockout');
        button.id = 'lockout-log-btn';
        button.disabled = true;
        button.style.opacity = '0.6';
        button.style.cursor = 'not-allowed';
        
        // Enable button quickly
        setTimeout(() => {
            button.disabled = false;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
            button.textContent = 'Copy Lockout';
        }, CONFIG.BUTTON_ENABLE_DELAY);
        
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleButtonClick(button, 1, 'Copy Lockout', 'lockout', 'lockout');
        });
        
        anchor.appendChild(button);
        state.buttons.set('lockout-log-btn', button);
        state.performance.buttonCreationCount++;
        
        log('Lockout button created successfully');
    } catch (err) {
        error('createLockoutButton error:', err);
    }
}

function createLogButtons() {
    try {
        // 1. Individual Package Buttons
        const issueButtons = Array.from(
            document.querySelectorAll('button, input[type="button"], a.button')
        ).filter(b => 
            b.textContent.toLowerCase().includes('issue') && 
            !b.textContent.toLowerCase().includes('reissue')
        );
        
        issueButtons.forEach((btn, i) => {
            const buttonId = `pkg-btn-${i}`;
            
            if (document.getElementById(buttonId)) return;
            
            const button = createStyledButton('Copy Log', 'primary');
            button.id = buttonId;
            
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleButtonClick(button, 1, 'Copy Log', 'primary', 'package');
            });
            
            btn.parentNode.insertBefore(button, btn.nextSibling);
            state.buttons.set(buttonId, button);
            state.performance.buttonCreationCount++;
        });

        // 2. Master Package Button (for multiple packages)
        const parcelCount = Array.from(document.querySelectorAll('span')).find(s => 
            /^\d+\s+Parcel[s]?$/i.test(s.textContent.trim())
        );
        
        if (parcelCount && !document.getElementById('pkg-master')) {
            const count = parseInt(parcelCount.textContent);
            
            if (count > 1) {
                const button = createStyledButton(`Copy ${count} pkgs`, 'secondary');
                button.id = 'pkg-master';
                
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleButtonClick(button, count, `Copy ${count} pkgs`, 'secondary', 'package');
                });
                
                parcelCount.parentNode.insertBefore(button, parcelCount.nextSibling);
                state.buttons.set('pkg-master', button);
                state.performance.buttonCreationCount++;
            }
        }

        // 3. Lockout Button
        createLockoutButton();
        
        // 4. Print Label Button
        const entryActions = Array.from(document.querySelectorAll('button')).find(el => 
            /Entry Actions/i.test(el.textContent)
        );
        
        if (entryActions && !document.getElementById('pkg-label')) {
            const button = createStyledButton('Print Label', 'label');
            button.id = 'pkg-label';
            
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleButtonClick(button, 1, 'Print Label', 'label', 'label');
            });
            
            entryActions.parentNode.insertBefore(button, entryActions);
            state.buttons.set('pkg-label', button);
            state.performance.buttonCreationCount++;
        }
        
        log(`Created ${state.buttons.size} buttons total`);
    } catch (err) {
        error('createLogButtons error:', err);
    }
}

// ============================================================================
// PROFILE SWITCHING DETECTION - New in v3.0
// ============================================================================

function hasProfileChanged() {
    const currentBreadcrumb = getCurrentBreadcrumb();
    
    if (!currentBreadcrumb) return false;
    
    // Check if breadcrumb has changed
    if (currentBreadcrumb !== state.previousStudent.breadcrumb) {
        log('Profile change detected:', {
            previous: state.previousStudent.breadcrumb,
            current: currentBreadcrumb
        });
        return true;
    }
    
    return false;
}

function updateProfileTracking() {
    const currentBreadcrumb = getCurrentBreadcrumb();
    const studentData = getStudentDataFromRez360();
    
    if (currentBreadcrumb) {
        state.previousStudent.breadcrumb = currentBreadcrumb;
    }
    
    if (studentData) {
        state.previousStudent.studentNumber = studentData.studentNumber;
    }
}

// ============================================================================
// INITIALIZATION - Enhanced for SPA navigation
// ============================================================================

function clearOldButtons() {
    try {
        // Remove all tracked buttons
        state.buttons.forEach((button, id) => {
            if (button && button.parentNode) {
                button.remove();
            }
        });
        
        state.buttons.clear();
        
        // Also remove any orphaned buttons (safety net)
        document.querySelectorAll('[id^="pkg-btn-"], #pkg-master, #lockout-log-btn, #pkg-label').forEach(b => {
            b.remove();
        });
        
        log('Old buttons cleared');
    } catch (err) {
        error('clearOldButtons error:', err);
    }
}

function initialize() {
    try {
        // Prevent concurrent initialization
        if (state.isInitializing) {
            log('Already initializing - skipping');
            return;
        }
        
        state.isInitializing = true;
        clearTimer('init');
        
        state.timers.init = setTimeout(() => {
            try {
                // Check if profile has changed
                if (hasProfileChanged()) {
                    log('New profile detected - clearing old buttons');
                    clearOldButtons();
                    
                    // Invalidate cache for new profile
                    state.currentStudent.timestamp = null;
                    
                    updateProfileTracking();
                }

                // Verify we're on a valid profile page
                const container = document.querySelector('.ui-tabs-panel:not(.ui-tabs-hide)') || document.body;
                const hasEntryID = container.innerText.includes('EntryID:');
                
                if (!hasEntryID && state.validationAttempts < CONFIG.MAX_VALIDATION_ATTEMPTS) {
                    state.validationAttempts++;
                    log(`Waiting for profile to load... (${state.validationAttempts}/${CONFIG.MAX_VALIDATION_ATTEMPTS})`);
                    
                    state.isInitializing = false;
                    setTimeout(initialize, 300);
                    return;
                }
                
                state.validationAttempts = 0;
                
                // Create buttons
                createLogButtons();
                
                // Track performance
                state.performance.lastInitTime = Date.now();
                
            } finally {
                state.isInitializing = false;
            }
        }, CONFIG.INIT_DEBOUNCE);
    } catch (err) {
        error('initialize error:', err);
        state.isInitializing = false;
    }
}

// ============================================================================
// DIAGNOSTICS - New in v3.0
// ============================================================================

function runDiagnostics() {
    console.log('='.repeat(60));
    console.log(`StarRez Package Logger v${CONFIG.VERSION} - DIAGNOSTICS`);
    console.log('='.repeat(60));
    
    // 1. Staff Information
    const staffName = getStaffName();
    console.log('\n1. STAFF INFORMATION:');
    console.log('   Name:', staffName || 'NOT FOUND');
    console.log('   Initials:', staffName ? getInitials(staffName) : 'N/A');
    
    // 2. Student Information
    const breadcrumb = getCurrentBreadcrumb();
    const studentData = getStudentDataFromRez360();
    console.log('\n2. STUDENT INFORMATION:');
    console.log('   Breadcrumb:', breadcrumb || 'NOT FOUND');
    
    if (studentData) {
        console.log('   ✓ Student data extracted successfully:');
        console.log('     - Name:', studentData.fullName);
        console.log('     - Student #:', studentData.studentNumber);
        console.log('     - Room:', studentData.roomSpace);
        console.log('     - Initials:', getInitials(studentData.fullName));
        console.log('     - Cached:', isStudentDataCached() ? 'Yes' : 'No');
    } else {
        console.log('   ✗ Student data NOT found');
    }
    
    // 3. Key Codes (if applicable)
    if (studentData) {
        const keyCodes = extractKeyCodes(studentData.fullName, studentData.studentNumber);
        console.log('\n3. KEY CODES:');
        if (keyCodes && keyCodes.length > 0) {
            console.log('   ✓ Keys found:', keyCodes.join(', '));
        } else {
            console.log('   ✗ No keys found for this student');
        }
    }
    
    // 4. Buttons
    console.log('\n4. BUTTONS:');
    console.log('   Created:', state.buttons.size);
    console.log('   IDs:', Array.from(state.buttons.keys()).join(', '));
    
    // 5. Performance
    console.log('\n5. PERFORMANCE:');
    console.log('   Total button creations:', state.performance.buttonCreationCount);
    console.log('   Error count:', state.performance.errorCount);
    console.log('   Last init:', new Date(state.performance.lastInitTime).toLocaleTimeString());
    
    // 6. Test Log Generation
    console.log('\n6. TEST LOG GENERATION:');
    const pkgLog = generateLogEntry(1);
    console.log('   Package Log:', pkgLog.success ? '✓' : '✗');
    if (pkgLog.success) console.log('   ', pkgLog.logEntry);
    
    const lockoutLog = generateLockoutEntry();
    console.log('   Lockout Log:', lockoutLog.success ? '✓' : '✗');
    if (lockoutLog.success) console.log('   ', lockoutLog.logEntry);
    
    const label = generatePackageLabel();
    console.log('   Label:', label.success ? '✓' : '✗');
    if (label.success) console.log('   ', label.logEntry.replace(/\n/g, ' | '));
    
    console.log('\n' + '='.repeat(60));
}

// Make diagnostics available globally
window.StarRezLoggerDiagnostics = runDiagnostics;

// ============================================================================
// STARTUP & OBSERVER - Enhanced monitoring
// ============================================================================

function startup() {
    try {
        log('Starting up...');
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        
        // Initialize
        initialize();
        
        // Setup mutation observer for SPA navigation
        const observer = new MutationObserver(() => {
            clearTimer('observer');
            state.timers.observer = setTimeout(() => {
                initialize();
            }, CONFIG.OBSERVER_DEBOUNCE);
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        log('Startup complete - Observer active');
        log('Run window.StarRezLoggerDiagnostics() for diagnostics');
        
    } catch (err) {
        error('startup error:', err);
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startup);
} else {
    startup();
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    clearAllTimers();
    observer?.disconnect();
});

log(`StarRez Package Logger v${CONFIG.VERSION} Loaded Successfully`);
