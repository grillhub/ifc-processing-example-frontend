// API Endpoints Configuration (loaded from settings.json)
let API_BASE_URL = null;
let MAIN_ENDPOINT = null;
let AUTH_ENDPOINT = null;
let CLOUDFRONT_AUTH_ENDPOINT = null;
let CSV_SCHEMA_URL = null;
let accessToken = null; // Store access token after login
// CloudFront auth result: query string "Policy=...&Signature=...&Key-Pair-Id=..."
let cloudfrontToken = "";

let currentProcessingId = null;
let statusInterval = null;
let csvFileCount = 0;
let processingMetadata = null; // Store processing metadata for launch buttons
let csvSchema = null; // Store CSV schema data

// Theme management
let currentTheme = localStorage.getItem('theme') || 'light';

// Load settings from settings.json
async function loadSettings() {
    try {
        const response = await fetch('settings.json');
        if (!response.ok) {
            throw new Error('Failed to load settings.json');
        }
        const settings = await response.json();
        
        API_BASE_URL = settings.API_BASE_URL;
        MAIN_ENDPOINT = settings.MAIN_ENDPOINT;
        AUTH_ENDPOINT = settings.AUTH_ENDPOINT;
        CLOUDFRONT_AUTH_ENDPOINT = settings.CLOUDFRONT_AUTH_ENDPOINT;
        CSV_SCHEMA_URL = MAIN_ENDPOINT + 'CSVSchema.json';
        
    } catch (error) {
        console.error('Error loading settings:', error);
        API_BASE_URL = '';
        MAIN_ENDPOINT = '';
        AUTH_ENDPOINT = '';
        CLOUDFRONT_AUTH_ENDPOINT = '';
        CSV_SCHEMA_URL = MAIN_ENDPOINT + 'CSVSchema.json';
        showAlert('Warning: Could not load settings.json. Using default configuration.', 'error');
    }
}

// Initialize application after settings are loaded
async function initializeApp() {
    await loadSettings();
    
    accessToken = localStorage.getItem('accessToken');
    if (accessToken) {
        await requestCloudFrontAuth();
        showMainApp();
    } else {
        showLoginPage();
    }
    
    initializeTheme();
    initializeAnimations();
}

// Show login page
function showLoginPage() {
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('statusSection').style.display = 'none';
    document.getElementById('completedSection').style.display = 'none';
}

// Show main application after login
function showMainApp() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('uploadSection').style.display = 'block';
    checkServerStatus();
    fetchCsvSchema();
}

async function requestCloudFrontAuth() {
    cloudfrontToken = "";
    if (!CLOUDFRONT_AUTH_ENDPOINT || !accessToken) {
        return true;
    }
    try {
        const response = await fetch(CLOUDFRONT_AUTH_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + accessToken
            }
        });
        if (!response.ok) {
            console.warn('CloudFront auth request failed:', response.status, response.statusText);
            return false;
        }
        const auth = await response.json();
        if (!auth || !auth.success || !auth.cookies) {
            console.warn('CloudFront auth response invalid or success=false.');
            return false;
        }
        let resourceScope = (auth.resourceScope || "").replace(/\*+$/, '').trim();
        if (!resourceScope) {
            console.warn('CloudFront auth resourceScope missing.');
            return false;
        }
        MAIN_ENDPOINT = resourceScope.endsWith('/') ? resourceScope : resourceScope + '/';
        CSV_SCHEMA_URL = MAIN_ENDPOINT + 'CSVSchema.json';
        const c = auth.cookies;
        const policy = c['CloudFront-Policy'] ?? c.CloudFrontPolicy;
        const signature = c['CloudFront-Signature'] ?? c.CloudFrontSignature;
        const keyPairId = c['CloudFront-Key-Pair-Id'] ?? c.CloudFrontKeyPairId;
        const parts = [];
        if (policy) parts.push('Policy=' + encodeURIComponent(policy));
        if (signature) parts.push('Signature=' + encodeURIComponent(signature));
        if (keyPairId) parts.push('Key-Pair-Id=' + encodeURIComponent(keyPairId));
        cloudfrontToken = parts.join('&');
        console.log('CloudFront auth success.');
        return true;
    } catch (ex) {
        console.warn('CloudFront auth error:', ex.message);
        return false;
    }
}

// Build thumbnail URL with CloudFront Policy/Signature/Key-Pair-Id or token.
function buildThumbnailUrl(thumbnailUrl) {
    if (!cloudfrontToken) return thumbnailUrl;
    const separator = thumbnailUrl.includes('?') ? '&' : '?';
    return thumbnailUrl + separator + cloudfrontToken;
}

// Login function
async function handleLogin(event) {
    event.preventDefault();
    
    const email = document.getElementById('userEmail').value;
    const password = document.getElementById('userPassword').value;
    const loginBtn = document.getElementById('loginBtn');
    const btnText = loginBtn.querySelector('.btn-text');
    const btnSpinner = loginBtn.querySelector('.btn-spinner');
    
    loginBtn.disabled = true;
    btnText.textContent = 'Signing in...';
    btnSpinner.style.display = 'inline';
    
    try {
        const response = await fetch(AUTH_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'signin',
                user: email,
                pass: password
            })
        });
        
        const result = await response.json();
        
        if (result.success && result.authResult && result.authResult.accessToken) {
            accessToken = result.authResult.accessToken;
            localStorage.setItem('accessToken', accessToken);
            await requestCloudFrontAuth();
            showAlert('Login successful!', 'success');
            showMainApp();
        } else {
            showAlert('Login failed: ' + (result.message || 'Invalid credentials'), 'error');
        }
    } catch (error) {
        showAlert('Login failed: ' + error.message, 'error');
    } finally {
        loginBtn.disabled = false;
        btnText.textContent = 'Sign In';
        btnSpinner.style.display = 'none';
    }
}

// Check server status on load
window.addEventListener('load', function() {
    initializeApp();
});

// Login form submission
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

// File input handling
document.getElementById('ifcFile').addEventListener('change', function(e) {
    const fileName = e.target.files[0]?.name || 'Choose a BIM IFC file';
    const fileLabel = document.querySelector('.file-input-label');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const fileNameSpan = fileNameDisplay.querySelector('span');
    
    fileLabel.textContent = 'Choose a BIM IFC file';
    fileNameSpan.textContent = fileName;
    document.getElementById('fileInputText').textContent = fileName;
    
    if (fileName !== 'Choose a BIM IFC file') {
        fileNameDisplay.classList.add('has-file');
    } else {
        fileNameDisplay.classList.remove('has-file');
    }
});

// Form submission
document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();
    uploadFile();
});

// LOD change event listener to clear CSV files
document.getElementById('selectedLOD').addEventListener('change', function(e) {
    clearAllCsvFiles();
});

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/status`);
        if (response.ok) {
            document.getElementById('serverStatus').textContent = 'Connected';
            document.getElementById('serverStatus').className = 'server-status connected';
        } else {
            throw new Error('Server not responding');
        }
    } catch (error) {
        document.getElementById('serverStatus').textContent = 'Disconnected';
        document.getElementById('serverStatus').className = 'server-status disconnected';
    }
}

// Fetch CSV schema from AWS S3
async function fetchCsvSchema() {
    try {
        const url = cloudfrontToken
            ? CSV_SCHEMA_URL + (CSV_SCHEMA_URL.includes('?') ? '&' : '?') + cloudfrontToken
            : CSV_SCHEMA_URL;
        const response = await fetch(url);
        if (response.ok) {
            csvSchema = await response.json();
            // console.log('CSV schema loaded successfully:', csvSchema);
        } else {
            throw new Error('Failed to fetch CSV schema');
        }
    } catch (error) {
        console.error('Error fetching CSV schema:', error);
        showAlert('Warning: Could not load CSV validation schema. CSV files will not be validated.', 'error');
    }
}

// Validate CSV file against schema
function validateCsvFile(file, selectedLOD, selectedSchemaOption = null) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const csvContent = e.target.result;
                const lines = csvContent.split('\n');
                
                if (lines.length < 2) {
                    resolve({
                        isValid: false,
                        error: 'CSV file must contain at least a header row and one data row',
                        schemaName: null,
                        requiresSelection: false,
                        selectionOptions: []
                    });
                    return;
                }
                
                // Get header row (first line)
                const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''));
                
                // Find matching schema based on selectedLOD
                const matchingSchemas = csvSchema.schema.filter(schema => schema.selectedLOD === selectedLOD);
                
                if (matchingSchemas.length === 0) {
                    resolve({
                        isValid: true,
                        error: `No schema found for selected LOD: ${selectedLOD}. File will be accepted without validation.`,
                        schemaName: null,
                        requiresSelection: false,
                        selectionOptions: [],
                        warning: true
                    });
                    return;
                }
                
                // Check each schema to find a match
                for (const schema of matchingSchemas) {
                    const schemaColumns = schema.columns || schema.columnName || [];
                    
                    // Check if all schema columns are present in CSV headers
                    const missingColumns = schemaColumns.filter(col => !headers.includes(col));
                    const extraColumns = headers.filter(header => !schemaColumns.includes(header));
                    
                    if (missingColumns.length === 0) {
                        // Check if this schema requires selection
                        if (schema.selection && schema.selection.length > 0) {
                            if (!selectedSchemaOption) {
                                resolve({
                                    isValid: false,
                                    error: `Schema "${schema.name}" requires selection of one option`,
                                    schemaName: schema.name,
                                    requiresSelection: true,
                                    selectionOptions: schema.selection,
                                    missingColumns: [],
                                    extraColumns: extraColumns,
                                    matchedColumns: schemaColumns
                                });
                                return;
                            } else if (!schema.selection.includes(selectedSchemaOption)) {
                                resolve({
                                    isValid: false,
                                    error: `Invalid selection "${selectedSchemaOption}" for schema "${schema.name}". Valid options: ${schema.selection.join(', ')}`,
                                    schemaName: schema.name,
                                    requiresSelection: true,
                                    selectionOptions: schema.selection,
                                    missingColumns: [],
                                    extraColumns: extraColumns,
                                    matchedColumns: schemaColumns
                                });
                                return;
                            }
                        }
                        
                        resolve({
                            isValid: true,
                            schemaName: schema.name,
                            selectedOption: selectedSchemaOption,
                            missingColumns: [],
                            extraColumns: extraColumns,
                            matchedColumns: schemaColumns,
                            requiresSelection: schema.selection && schema.selection.length > 0,
                            selectionOptions: schema.selection || []
                        });
                        return;
                    }
                }
                
                // If no exact match found, find the closest match
                let bestMatch = null;
                let minMissingColumns = Infinity;
                
                for (const schema of matchingSchemas) {
                    const schemaColumns = schema.columns || schema.columnName || [];
                    const missingColumns = schemaColumns.filter(col => !headers.includes(col));
                    
                    if (missingColumns.length < minMissingColumns) {
                        minMissingColumns = missingColumns.length;
                        bestMatch = schema;
                    }
                }
                
                if (bestMatch) {
                    const schemaColumns = bestMatch.columns || bestMatch.columnName || [];
                    const missingColumns = schemaColumns.filter(col => !headers.includes(col));
                    const extraColumns = headers.filter(header => !schemaColumns.includes(header));
                    
                    // If there are missing columns, treat as no schema found
                    if (missingColumns.length > 0) {
                        // Limit display of missing columns if more than 4
                        let missingColumnsText;
                        if (missingColumns.length > 4) {
                            missingColumnsText = `${missingColumns.slice(0, 3).join(', ')} and ${missingColumns.length - 3} more`;
                        } else {
                            missingColumnsText = missingColumns.join(', ');
                        }
                        
                        resolve({
                            isValid: true,
                            error: `CSV columns do not match schema "${bestMatch.name}". Missing columns: ${missingColumnsText}. File will be accepted without validation.`,
                            schemaName: null,
                            requiresSelection: false,
                            selectionOptions: [],
                            warning: true
                        });
                    } else {
                        // Only extra columns, still consider it valid
                        resolve({
                            isValid: true,
                            error: `CSV has extra columns not in schema "${bestMatch.name}". File will be accepted.`,
                            schemaName: bestMatch.name,
                            missingColumns: [],
                            extraColumns: extraColumns,
                            matchedColumns: schemaColumns.filter(col => headers.includes(col)),
                            requiresSelection: bestMatch.selection && bestMatch.selection.length > 0,
                            selectionOptions: bestMatch.selection || [],
                            warning: true
                        });
                    }
                } else {
                    resolve({
                        isValid: true,
                        error: `No suitable schema found for selected LOD: ${selectedLOD}. File will be accepted without validation.`,
                        schemaName: null,
                        requiresSelection: false,
                        selectionOptions: [],
                        warning: true
                    });
                }
                
            } catch (error) {
                resolve({
                    isValid: false,
                    error: 'Error parsing CSV file: ' + error.message,
                    schemaName: null,
                    requiresSelection: false,
                    selectionOptions: []
                });
            }
        };
        
        reader.onerror = function() {
            resolve({
                isValid: false,
                error: 'Error reading CSV file',
                schemaName: null,
                requiresSelection: false,
                selectionOptions: []
            });
        };
        
        reader.readAsText(file);
    });
}

async function uploadFile() {
    const formData = new FormData();
    const ifcFile = document.getElementById('ifcFile').files[0];
    
    if (!ifcFile) {
        showAlert('Please select an IFC file', 'error');
        return;
    }

    // Validate CSV files before upload
    const csvFiles = document.querySelectorAll('.csv-file');
    for (const csvFile of csvFiles) {
        const fileInput = csvFile.querySelector('input[type="file"]');
        const validationResult = csvFile.dataset.validationResult;
        const schemaSelection = csvFile.querySelector('.schema-selection');
        const schemaOptionSelect = csvFile.querySelector('.schema-option-select');
        
        if (fileInput.files[0]) {
            if (!validationResult) {
                showAlert('Please wait for CSV validation to complete before uploading', 'error');
                return;
            }
            
            const result = JSON.parse(validationResult);
            if (!result.isValid) {
                showAlert(`CSV file "${fileInput.files[0].name}" failed validation: ${result.error}`, 'error');
                return;
            }
            
            // Check if schema requires selection and user hasn't selected
            if (result.requiresSelection && schemaSelection.style.display !== 'none') {
                const selectedOption = schemaOptionSelect.value;
                if (!selectedOption) {
                    showAlert(`CSV file "${fileInput.files[0].name}" requires schema selection. Please select an option from the dropdown.`, 'error');
                    return;
                }
            }
        }
    }

    formData.append('file', ifcFile);
    formData.append('buildingId', document.getElementById('buildingId').value);
    formData.append('description', document.getElementById('description').value);
    formData.append('userId', 'admin');
    formData.append('selectedLOD', document.getElementById('selectedLOD').value);

    // Add CSV files
    csvFiles.forEach((csvFile, index) => {
        const fileInput = csvFile.querySelector('input[type="file"]');
        const descriptionInput = csvFile.querySelector('input[name="csvDescription"]');
        const keyColumnInput = csvFile.querySelector('input[name="csvKeyColumn"]');
        const schemaOptionSelect = csvFile.querySelector('.schema-option-select');
        const validationResult = JSON.parse(csvFile.dataset.validationResult || '{}');
        
        if (fileInput.files[0]) {
            formData.append(`csvFile${index}`, fileInput.files[0]);
            formData.append(`csvDescription${index}`, descriptionInput.value);
            formData.append(`csvKeyColumn${index}`, keyColumnInput.value);
            formData.append(`csvSchemaName${index}`, validationResult.schemaName || '');
            formData.append(`csvSchemaOption${index}`, schemaOptionSelect ? schemaOptionSelect.value : '');
        }
    });

    try {
        const uploadBtn = document.getElementById('uploadBtn');
        const btnText = uploadBtn.querySelector('.btn-text');
        const btnSpinner = uploadBtn.querySelector('.btn-spinner');
        
        uploadBtn.disabled = true;
        btnText.textContent = 'Uploading...';
        btnSpinner.style.display = 'inline';
        showLoading(true);

        const response = await fetch(`${API_BASE_URL}/api/process-ifc`, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        if (result.success) {
            currentProcessingId = result.processingId;
            showAlert('File uploaded successfully! Processing started.', 'success');
            showStatusSection();
            startStatusPolling();
        } else {
            showAlert('Upload failed: ' + result.message, 'error');
        }
    } catch (error) {
        showAlert('Upload failed: ' + error.message, 'error');
    } finally {
        const uploadBtn = document.getElementById('uploadBtn');
        const btnText = uploadBtn.querySelector('.btn-text');
        const btnSpinner = uploadBtn.querySelector('.btn-spinner');
        
        uploadBtn.disabled = false;
        btnText.textContent = 'Start Processing';
        btnSpinner.style.display = 'none';
        showLoading(false);
    }
}

function startStatusPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
    }

    statusInterval = setInterval(async () => {
        if (!currentProcessingId) return;

        try {
            const response = await fetch(`${API_BASE_URL}/api/status/${currentProcessingId}`);
            const status = await response.json();

            updateStatusDisplay(status);

            if (status.status === 'completed' || status.status === 'failed') {
                clearInterval(statusInterval);
                console.log('Processing finished with status:', status.status);
                if (status.status === 'completed') {
                    showAlert('Processing completed successfully!', 'success');
                    console.log('Setting timeout to show completed section...');
                    // Show completed section after 1 second delay; refresh CloudFront token so thumbnail URL has valid auth
                    setTimeout(async () => {
                        showCompletedSection(status);
                    }, 1000);
                } else {
                    showAlert('Processing failed: ' + status.message, 'error');
                    // Show back button when processing fails
                    document.getElementById('statusActions').style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Error checking status:', error);
        }
    }, 2000); // Poll every 2 seconds
}

function updateStatusDisplay(status) {
    // Update status details
    document.getElementById('statusValue').textContent = status.status;
    document.getElementById('progressValue').textContent = Math.round(status.progress * 100) + '%';
    document.getElementById('processingIdValue').textContent = status.processingId;
    
    // Update spinner content
    const progressPercent = Math.round(status.progress * 100);
    const spinnerFileName = document.getElementById('spinnerFileName');
    const processingText = document.getElementById('processingText');
    
    // Update file name
    const buildingId = document.getElementById('buildingId').value || 'CEN047';
    const fileName = document.getElementById('ifcFile').files[0]?.name || `${buildingId}.ifc`;
    spinnerFileName.textContent = fileName;
    
    // Update processing text based on status
    if (status.status === 'processing') {
        processingText.textContent = 'Processing...';
        processingText.style.color = 'var(--primary-blue)';
    } else if (status.status === 'completed') {
        processingText.textContent = 'Completed!';
        processingText.style.color = 'var(--success)';
    } else if (status.status === 'failed') {
        processingText.textContent = 'Failed';
        processingText.style.color = 'var(--error)';
    } else {
        processingText.textContent = status.status.charAt(0).toUpperCase() + status.status.slice(1);
        processingText.style.color = 'var(--text-secondary)';
    }
}

function showStatusSection() {
    // Hide the upload section and show only status section
    document.getElementById('uploadSection').style.display = 'none';
    const statusSection = document.getElementById('statusSection');
    statusSection.style.display = 'block';
    
    // Update building ID highlight
    const buildingId = document.getElementById('buildingId').value || 'CEN047';
    document.getElementById('buildingIdHighlight').textContent = buildingId;
    
    // Initialize spinner content
    const fileName = document.getElementById('ifcFile').files[0]?.name || `${buildingId}.ifc`;
    document.getElementById('spinnerFileName').textContent = fileName;
    document.getElementById('processingText').textContent = 'Processing...';
    
    // Force spinner animation to start (fixes no spin when section was display:none)
    const largeSpinner = statusSection.querySelector('.large-spinner');
    const spinnerContent = statusSection.querySelector('.spinner-content');
    if (largeSpinner) {
        largeSpinner.style.animation = 'none';
        largeSpinner.offsetHeight;
        largeSpinner.style.animation = '';
    }
    if (spinnerContent) {
        spinnerContent.style.animation = 'none';
        spinnerContent.offsetHeight;
        spinnerContent.style.animation = '';
    }
}

function showCompletedSection(status) {
    console.log('showCompletedSection called with status:', status);
    
    // Hide status section and show completed section
    document.getElementById('statusSection').style.display = 'none';
    document.getElementById('completedSection').style.display = 'block';
    
    console.log('Status section hidden, completed section shown');
    
    // Update building ID in completed section
    const buildingId = document.getElementById('buildingId').value || 'CEN047';
    document.getElementById('completedBuildingId').textContent = buildingId;
    
    // Show thumbnail if available
    if (status.metadata && status.metadata.thumbnailUrl) {
        const completedThumbnailImage = document.getElementById('completedThumbnailImage');
        completedThumbnailImage.src = buildThumbnailUrl(status.metadata.thumbnailUrl);
        completedThumbnailImage.style.display = 'block';
        
        // Handle image load error
        completedThumbnailImage.onerror = function() {
            console.warn('Failed to load thumbnail:', buildThumbnailUrl(status.metadata.thumbnailUrl));
            completedThumbnailImage.style.display = 'none';
        };
    } else {
        // Hide thumbnail if not available
        document.getElementById('completedThumbnailImage').style.display = 'none';
    }
    
    // Update button visibility based on metadata
    const areaMapBtn = document.getElementById('completedLaunchAreaMapBtn');
    const bimBtn = document.getElementById('completedLaunchBimBtn');
    
    if (status.metadata && status.metadata.areaBimEndpoint) {
        areaMapBtn.style.display = 'flex';
    } else {
        areaMapBtn.style.display = 'none';
    }
    
    if (status.metadata && status.metadata.individualBimEndpoint) {
        bimBtn.style.display = 'flex';
    } else {
        bimBtn.style.display = 'none';
    }
    
    // Store metadata for launch functions
    processingMetadata = status.metadata;
    
    // Add fade-in animation
    const completedSection = document.getElementById('completedSection');
    completedSection.style.opacity = '0';
    setTimeout(() => {
        completedSection.style.transition = 'opacity 0.3s ease';
        completedSection.style.opacity = '1';
    }, 50);
    
    console.log('Completed section setup complete');
}

function showLoading(show) {
    const loadingSection = document.getElementById('loadingSection');
    if (show) {
        loadingSection.style.display = 'flex';
        loadingSection.style.opacity = '0';
        const overlaySpinner = loadingSection.querySelector('.spinner');
        if (overlaySpinner) {
            overlaySpinner.style.animation = 'none';
            overlaySpinner.offsetHeight;
            overlaySpinner.style.animation = '';
        }
        setTimeout(() => {
            loadingSection.style.opacity = '1';
        }, 10);
    } else {
        loadingSection.style.opacity = '0';
        setTimeout(() => {
            loadingSection.style.display = 'none';
        }, 300);
    }
}

function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${type}`;
    alertDiv.textContent = message;
    
    const content = document.querySelector('.content');
    content.insertBefore(alertDiv, content.firstChild);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

function addCsvFile() {
    const container = document.getElementById('csvFilesContainer');
    const csvDiv = document.createElement('div');
    csvDiv.className = 'csv-file';
    csvDiv.style.opacity = '0';
    
    csvDiv.innerHTML = `
        <div class="csv-file-header">
            <h4>CSV File ${csvFileCount + 1}</h4>
            <div class="csv-file-header-buttons">
                <button type="button" class="remove-csv" onclick="removeCsvFile(this)">Remove</button>
            </div>
        </div>
        <div class="csv-file-content">
            <div class="csv-file-main-row">
                <div class="csv-file-input-section">
                    <label>CSV File</label>
                    <div class="csv-file-input-container">
                        <div class="custom-file-input">
                            <input type="file" accept=".csv" required>
                            <label class="file-input-label">Choose a CSV file</label>
                        </div>
                        <div class="file-name-display">
                            <span>No file selected</span>
                        </div>
                    </div>
                </div>
                <div class="csv-validation-status">
                    <div class="validation-icon default"></div>
                    <div class="validation-message">No file selected</div>
                    <div class="schema-name" style="display: none;"></div>
                </div>
                <div class="schema-selection">
                    <label>Type *</label>
                    <select class="schema-option-select">
                        <option value="">Select an option...</option>
                    </select>
                </div>
            </div>
            <div class="csv-file-details-row">
                <div>
                    <label>Description *</label>
                    <input type="text" name="csvDescription" placeholder="Description of this CSV file">
                </div>
                <div>
                    <label>Column header</label>
                    <input type="text" name="csvKeyColumn" placeholder="Column name for merging with BIM data">
                </div>
            </div>
        </div>
    `;
    
    container.appendChild(csvDiv);
    
    // Add event listener for CSV file input
    const csvFileInput = csvDiv.querySelector('input[type="file"]');
    const csvFileLabel = csvDiv.querySelector('.file-input-label');
    const csvFileNameDisplay = csvDiv.querySelector('.file-name-display');
    const csvFileNameSpan = csvFileNameDisplay.querySelector('span');
    const validationStatus = csvDiv.querySelector('.csv-validation-status');
    const validationIcon = csvDiv.querySelector('.validation-icon');
    const validationMessage = csvDiv.querySelector('.validation-message');
    const schemaName = csvDiv.querySelector('.schema-name');
    const schemaSelection = csvDiv.querySelector('.schema-selection');
    const schemaOptionSelect = csvDiv.querySelector('.schema-option-select');
    
    // Function to validate CSV with current selection
    const validateCurrentCsv = async () => {
        if (csvSchema && csvFileInput.files[0]) {
            const selectedLOD = document.getElementById('selectedLOD').value;
            const selectedOption = schemaOptionSelect.value || null;
            
            validationIcon.textContent = '';
            validationMessage.textContent = 'Validating...';
            validationIcon.className = 'validation-icon validating';
            
            try {
                const validationResult = await validateCsvFile(csvFileInput.files[0], selectedLOD, selectedOption);
                
                if (validationResult.isValid) {
                    validationIcon.textContent = '';
                    if (validationResult.warning) {
                        validationMessage.textContent = validationResult.error;
                        validationIcon.className = 'validation-icon warning';
                        schemaName.textContent = 'No schema validation';
                        schemaName.style.display = 'block';
                        
                        // Disable dropdown for warning cases (no schema)
                        schemaOptionSelect.disabled = true;
                        schemaOptionSelect.innerHTML = '<option value="">No selection required</option>';
                    } else {
                        validationMessage.textContent = 'Valid CSV file';
                        validationIcon.className = 'validation-icon valid';
                        schemaName.textContent = `Schema: ${validationResult.schemaName}${validationResult.selectedOption ? ` (${validationResult.selectedOption})` : ''}`;
                        schemaName.style.display = 'block';
                        
                        // Enable/disable dropdown based on whether selection is required
                        if (validationResult.requiresSelection && validationResult.selectionOptions.length > 0) {
                            schemaOptionSelect.disabled = false;
                            // Preserve the currently selected value
                            const currentValue = schemaOptionSelect.value;
                            schemaOptionSelect.innerHTML = '<option value="">Select an option...</option>';
                            validationResult.selectionOptions.forEach(option => {
                                const optionElement = document.createElement('option');
                                optionElement.value = option;
                                optionElement.textContent = option;
                                schemaOptionSelect.appendChild(optionElement);
                            });
                            // Restore the selected value if it's still valid
                            if (currentValue && validationResult.selectionOptions.includes(currentValue)) {
                                schemaOptionSelect.value = currentValue;
                            }
                        } else {
                            schemaOptionSelect.disabled = true;
                            schemaOptionSelect.innerHTML = '<option value="">No selection required</option>';
                        }
                    }
                    
                    // Store validation result for form submission
                    csvDiv.dataset.validationResult = JSON.stringify(validationResult);
                } else {
                    validationIcon.textContent = '';
                    validationMessage.textContent = validationResult.error;
                    validationIcon.className = 'validation-icon invalid';
                    schemaName.style.display = 'none';
                    
                    // Show selection dropdown if required
                    if (validationResult.requiresSelection && validationResult.selectionOptions.length > 0) {
                        schemaOptionSelect.disabled = false;
                        // Preserve the currently selected value
                        const currentValue = schemaOptionSelect.value;
                        schemaOptionSelect.innerHTML = '<option value="">Select an option...</option>';
                        validationResult.selectionOptions.forEach(option => {
                            const optionElement = document.createElement('option');
                            optionElement.value = option;
                            optionElement.textContent = option;
                            schemaOptionSelect.appendChild(optionElement);
                        });
                        // Restore the selected value if it's still valid
                        if (currentValue && validationResult.selectionOptions.includes(currentValue)) {
                            schemaOptionSelect.value = currentValue;
                        }
                    } else {
                        // Disable dropdown when no selection is required
                        schemaOptionSelect.disabled = true;
                        schemaOptionSelect.innerHTML = '<option value="">No selection required</option>';
                        
                        // Clear the file input if validation fails and no selection needed
                        if (!validationResult.requiresSelection) {
                            csvFileInput.value = '';
                            csvFileNameSpan.textContent = 'No file selected';
                            csvFileNameDisplay.classList.remove('has-file');
                            showAlert(`CSV validation failed: ${validationResult.error}`, 'error');
                        }
                    }
                }
            } catch (error) {
                validationIcon.textContent = '';
                validationMessage.textContent = 'Validation error';
                validationIcon.className = 'validation-icon invalid';
                schemaName.style.display = 'none';
                
                showAlert('Error validating CSV file: ' + error.message, 'error');
            }
        } else {
            // No file selected - show default state
            validationIcon.textContent = '';
            validationMessage.textContent = 'No file selected';
            validationIcon.className = 'validation-icon default';
            schemaName.style.display = 'none';
            
            // Disable dropdown when no file is selected
            schemaOptionSelect.disabled = true;
            schemaOptionSelect.innerHTML = '<option value="">No file selected</option>';
        }
    };
    
    csvFileInput.addEventListener('change', async function(e) {
        const fileName = e.target.files[0]?.name || 'Choose a CSV file';
        csvFileLabel.textContent = 'Choose a CSV file';
        csvFileNameSpan.textContent = fileName;
        
        // Clear schema selection and validation data whenever file changes
        schemaOptionSelect.disabled = true;
        schemaOptionSelect.innerHTML = '<option value="">No file selected</option>';
        schemaOptionSelect.value = '';
        csvDiv.dataset.validationResult = '';
        
        if (fileName !== 'Choose a CSV file') {
            csvFileNameDisplay.classList.add('has-file');
        } else {
            csvFileNameDisplay.classList.remove('has-file');
        }
        
        await validateCurrentCsv();
    });
    
    // Add event listener for schema selection change
    schemaOptionSelect.addEventListener('change', async function() {
        if (csvFileInput.files[0]) {
            await validateCurrentCsv();
        }
    });
    
    // Subtle fade-in
    setTimeout(() => {
        csvDiv.style.transition = 'opacity 0.2s ease';
        csvDiv.style.opacity = '1';
    }, 10);
    
    csvFileCount++;
}

function removeCsvFile(button) {
    const csvFile = button.closest('.csv-file');
    csvFile.style.transition = 'opacity 0.2s ease';
    csvFile.style.opacity = '0';
    
    setTimeout(() => {
        csvFile.remove();
    }, 200);
}

function clearAllCsvFiles() {
    const csvContainer = document.getElementById('csvFilesContainer');
    
    // Add fade-out animation to all CSV files
    const csvFiles = csvContainer.querySelectorAll('.csv-file');
    csvFiles.forEach(csvFile => {
        csvFile.style.transition = 'opacity 0.2s ease';
        csvFile.style.opacity = '0';
    });
    
    // Clear the container after animation
    setTimeout(() => {
        csvContainer.innerHTML = '';
        csvFileCount = 0;
    }, 200);
}

// Auto-refresh server status every 30 seconds
setInterval(checkServerStatus, 30000);

// Theme functions
function initializeTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeIcon();
    
    // Add theme toggle event listener
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateThemeIcon();
}

function updateThemeIcon() {
    const themeIcon = document.querySelector('.theme-icon');
    if (currentTheme === 'light') {
        themeIcon.className = 'fas fa-moon theme-icon';
    } else {
        themeIcon.className = 'fas fa-sun theme-icon';
    }
}

// Animation functions
function initializeAnimations() {
    // Subtle fade-in for cards
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(8px)';
        setTimeout(() => {
            card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 50);
    });
}

// Enhanced file input handling
document.getElementById('ifcFile').addEventListener('change', function(e) {
    const fileName = e.target.files[0]?.name || 'Choose a BIM IFC file';
    const fileLabel = document.querySelector('.file-input-label');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const fileNameSpan = fileNameDisplay.querySelector('span');
    const fileText = document.getElementById('fileInputText');
    
    fileLabel.textContent = 'Choose a BIM IFC file';
    fileNameSpan.textContent = fileName;
    fileText.textContent = fileName;
    
    if (fileName !== 'Choose a BIM IFC file') {
        fileNameDisplay.classList.add('has-file');
    } else {
        fileNameDisplay.classList.remove('has-file');
    }
    
    // Add animation
    fileText.style.opacity = '0';
    setTimeout(() => {
        fileText.style.opacity = '1';
    }, 150);
});

// Show launch buttons after successful processing
function showLaunchButtons(metadata) {
    processingMetadata = metadata;
    const launchButtonsSection = document.getElementById('launchButtonsSection');
    
    // Show thumbnail if available
    if (metadata.thumbnailUrl) {
        showThumbnail(metadata.thumbnailUrl);
    }
    
    // Update button URLs based on metadata
    const areaMapBtn = document.getElementById('launchAreaMapBtn');
    const bimBtn = document.getElementById('launchBimBtn');
    
    if (metadata.areaBimEndpoint) {
        areaMapBtn.onclick = () => launchAreaMap();
        areaMapBtn.style.display = 'flex';
    } else {
        areaMapBtn.style.display = 'none';
    }
    
    if (metadata.individualBimEndpoint) {
        bimBtn.onclick = () => launchBim();
        bimBtn.style.display = 'flex';
    } else {
        bimBtn.style.display = 'none';
    }
    
    // Show the launch buttons section
    launchButtonsSection.style.display = 'block';
    
    // Add fade-in animation
    launchButtonsSection.style.opacity = '0';
    setTimeout(() => {
        launchButtonsSection.style.transition = 'opacity 0.3s ease';
        launchButtonsSection.style.opacity = '1';
    }, 100);
}

// Show thumbnail image
function showThumbnail(thumbnailUrl) {
    const thumbnailSection = document.getElementById('thumbnailSection');
    const thumbnailImage = document.getElementById('thumbnailImage');
    
    thumbnailImage.src = buildThumbnailUrl(thumbnailUrl);
    
    // Show the thumbnail section
    thumbnailSection.style.display = 'flex';
    
    // Add fade-in animation
    thumbnailSection.style.opacity = '0';
    setTimeout(() => {
        thumbnailSection.style.transition = 'opacity 0.3s ease';
        thumbnailSection.style.opacity = '1';
    }, 50);
    
    // Handle image load error
    thumbnailImage.onerror = function() {
        console.warn('Failed to load thumbnail:', buildThumbnailUrl(thumbnailUrl));
        thumbnailSection.style.display = 'none';
    };
}

// Launch area map page
function launchAreaMap() {
    if (processingMetadata && processingMetadata.areaBimEndpoint) {
        const url = processingMetadata.areaBimEndpoint;
        const separator = url.includes('?') ? '&' : '?';
        window.open(url + separator + 'token=' + encodeURIComponent(accessToken || ''), '_blank');
    } else {
        showAlert('Area map endpoint not available', 'error');
    }
}

// Launch BIM page with building ID
function launchBim() {
    if (processingMetadata && processingMetadata.individualBimEndpoint) {
        const buildingId = document.getElementById('buildingId').value;
        const baseVersion = processingMetadata.totalBIMversion;
        const version = (parseInt(baseVersion) + 1).toString();
        // Add token parameter to individualBimEndpoint
        const bimUrl = processingMetadata.individualBimEndpoint + 
            '?building_id=' + encodeURIComponent(buildingId) + 
            '&v=' + encodeURIComponent(version) + 
            '&p=full&d=normal' +
            '&token=' + encodeURIComponent(accessToken || '');
        window.open(bimUrl, '_blank');
    } else {
        showAlert('BIM endpoint not available', 'error');
    }
}

// Building ID Info Modal Functions
function showBuildingIdInfo() {
    const modal = document.getElementById('buildingIdInfoModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s ease';
        modal.style.opacity = '1';
    }, 10);
}

function hideBuildingIdInfo() {
    const modal = document.getElementById('buildingIdInfoModal');
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Close modal when clicking outside
document.addEventListener('click', function(event) {
    const modal = document.getElementById('buildingIdInfoModal');
    if (event.target === modal) {
        hideBuildingIdInfo();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const modal = document.getElementById('buildingIdInfoModal');
        if (modal.style.display === 'flex') {
            hideBuildingIdInfo();
        }
    }
});

// Back to upload function
function backToUpload() {
    // Show upload section and hide all other sections
    document.getElementById('uploadSection').style.display = 'block';
    document.getElementById('statusSection').style.display = 'none';
    document.getElementById('completedSection').style.display = 'none';
    document.getElementById('statusActions').style.display = 'none';
    document.getElementById('launchButtonsSection').style.display = 'none';
    document.getElementById('thumbnailSection').style.display = 'none';
    
    // Reset form
    document.getElementById('uploadForm').reset();
    document.getElementById('fileInputText').textContent = 'Choose a BIM IFC file';
    const fileLabel = document.querySelector('.file-input-label');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const fileNameSpan = fileNameDisplay.querySelector('span');
    
    if (fileLabel) {
        fileLabel.textContent = 'Choose a BIM IFC file';
    }
    if (fileNameSpan) {
        fileNameSpan.textContent = 'No file selected';
        fileNameDisplay.classList.remove('has-file');
    }
    
    // Clear CSV files
    const csvContainer = document.getElementById('csvFilesContainer');
    csvContainer.innerHTML = '';
    csvFileCount = 0;
    
    // Reset processing variables
    currentProcessingId = null;
    processingMetadata = null;
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
