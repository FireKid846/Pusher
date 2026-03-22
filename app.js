// GitHub File Pusher - Main Application Logic

class GitHubPusher {
    constructor() {
        this.config = this.loadConfig();
        this.fileTree = {};
        this.stagedFiles = {}; // Files with content (from zip or fetched)
        this.repoFiles = {}; // Files from GitHub (metadata with SHA)
        this.deletedFiles = new Set(); // Files marked for deletion
        this.selectedFiles = new Set();
        this.collapsedFolders = new Set();
        this.theme = localStorage.getItem('theme') || 'dark';
        
        this.init();
    }

    init() {
        this.applyTheme();
        this.setupEventListeners();
        this.loadSavedRepos();
        this.updateRepoIndicator();
    }

    // ============ Configuration Management ============
    loadConfig() {
        const saved = localStorage.getItem('github_pusher_config');
        return saved ? JSON.parse(saved) : {
            token: '',
            username: '',
            repo: '',
            branch: 'main'
        };
    }

    saveConfig() {
        const config = {
            token: document.getElementById('githubToken').value,
            username: document.getElementById('githubUsername').value,
            repo: document.getElementById('repoName').value,
            branch: document.getElementById('branchName').value
        };

        if (!config.token || !config.username || !config.repo) {
            this.showToast('Please fill in all required fields', 'error');
            return;
        }

        this.config = config;
        localStorage.setItem('github_pusher_config', JSON.stringify(config));
        this.saveToRepoList(config);
        this.showToast('Configuration saved successfully', 'success');
        this.updateRepoIndicator();
    }

    saveToRepoList(config) {
        let repos = JSON.parse(localStorage.getItem('saved_repos') || '[]');
        const repoKey = `${config.username}/${config.repo}`;
        
        // Remove if exists, then add to front
        repos = repos.filter(r => `${r.username}/${r.repo}` !== repoKey);
        repos.unshift(config);
        
        localStorage.setItem('saved_repos', JSON.stringify(repos));
        this.loadSavedRepos();
    }

    loadSavedRepos() {
        const repos = JSON.parse(localStorage.getItem('saved_repos') || '[]');
        const container = document.getElementById('repoList');
        
        if (repos.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary);">No saved repositories</p>';
            return;
        }

        container.innerHTML = repos.map((repo, index) => `
            <div class="repo-item" data-index="${index}">
                <div class="repo-info">
                    <strong>${repo.username}/${repo.repo}</strong>
                    <small>Branch: ${repo.branch}</small>
                </div>
                <div class="repo-actions">
                    <button class="btn btn-secondary btn-sm load-repo">Load</button>
                    <button class="btn btn-danger btn-sm delete-repo">Delete</button>
                </div>
            </div>
        `).join('');

        // Add event listeners
        container.querySelectorAll('.load-repo').forEach((btn, index) => {
            btn.addEventListener('click', () => this.loadRepo(repos[index]));
        });

        container.querySelectorAll('.delete-repo').forEach((btn, index) => {
            btn.addEventListener('click', () => this.deleteRepo(index));
        });
    }

    loadRepo(config) {
        this.config = config;
        document.getElementById('githubToken').value = config.token;
        document.getElementById('githubUsername').value = config.username;
        document.getElementById('repoName').value = config.repo;
        document.getElementById('branchName').value = config.branch;
        this.updateRepoIndicator();
        this.showToast('Repository loaded', 'success');
    }

    deleteRepo(index) {
        let repos = JSON.parse(localStorage.getItem('saved_repos') || '[]');
        repos.splice(index, 1);
        localStorage.setItem('saved_repos', JSON.stringify(repos));
        this.loadSavedRepos();
        this.showToast('Repository deleted', 'success');
    }

    updateRepoIndicator() {
        const indicator = document.getElementById('currentRepo');
        if (this.config.username && this.config.repo) {
            indicator.textContent = `${this.config.username}/${this.config.repo} (${this.config.branch})`;
        } else {
            indicator.textContent = 'No repo selected';
        }
    }

    // ============ GitHub API ============
    async testConnection() {
        if (!this.config.token || !this.config.username) {
            this.showToast('Please configure GitHub credentials first', 'error');
            return;
        }

        this.showLoading(true);
        
        try {
            const response = await fetch(`https://api.github.com/user`, {
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.showToast(`Connected as ${data.login}`, 'success');
            } else {
                this.showToast('Connection failed. Check your token.', 'error');
            }
        } catch (error) {
            this.showToast('Connection error: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async fetchRepoStructure() {
        if (!this.validateConfig()) return;

        this.showLoading(true);

        try {
            const response = await fetch(
                `https://api.github.com/repos/${this.config.username}/${this.config.repo}/git/trees/${this.config.branch}?recursive=1`,
                {
                    headers: {
                        'Authorization': `token ${this.config.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (!response.ok) {
                throw new Error('Failed to fetch repository');
            }

            const data = await response.json();
            
            // Clear and rebuild repo files
            this.repoFiles = {};
            
            // Store files with their metadata
            data.tree.forEach(file => {
                if (file.type === 'blob') {
                    this.repoFiles[file.path] = {
                        path: file.path,
                        sha: file.sha,
                        size: file.size,
                        fromRepo: true
                    };
                }
            });

            this.renderFileTree();
            this.updateChanges();
            this.showToast(`Loaded ${Object.keys(this.repoFiles).length} files from repository`, 'success');
        } catch (error) {
            this.showToast('Error: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // ============ File Management ============
    async handleZipUpload(file) {
        this.showLoading(true);

        try {
            const zip = await JSZip.loadAsync(file);
            const files = {};

            for (const [path, zipEntry] of Object.entries(zip.files)) {
                if (!zipEntry.dir) {
                    const content = await zipEntry.async('base64');
                    files[path] = {
                        content: content,
                        encoding: 'base64',
                        path: path
                    };
                }
            }

            // Merge with existing staged files
            this.stagedFiles = { ...this.stagedFiles, ...files };
            this.renderFileTree();
            this.updateChanges();
            this.showToast(`Loaded ${Object.keys(files).length} files from zip`, 'success');
        } catch (error) {
            this.showToast('Error loading zip: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    renderFileTree() {
        const container = document.getElementById('fileTree');
        
        // Combine repo files and staged files
        const allFiles = this.getAllFiles();

        if (Object.keys(allFiles).length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="folder-open"></i>
                    <p>No files loaded</p>
                    <small>Fetch repo structure or upload a zip</small>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        // Collapse all folders by default on first render
        if (this.collapsedFolders.size === 0) {
            this.collapseAllFolders(allFiles);
        }

        container.innerHTML = this.renderTree(allFiles);
        lucide.createIcons();
        this.attachFileTreeListeners();
    }

    getAllFiles() {
        const combined = {};
        
        // Add repo files
        Object.entries(this.repoFiles).forEach(([path, file]) => {
            if (!this.deletedFiles.has(path)) {
                combined[path] = file;
            }
        });
        
        // Add/override with staged files
        Object.entries(this.stagedFiles).forEach(([path, file]) => {
            combined[path] = file;
        });
        
        return this.buildTreeStructure(combined);
    }

    buildTreeStructure(files) {
        const tree = {};
        
        Object.entries(files).forEach(([path, file]) => {
            const parts = path.split('/');
            let current = tree;
            
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = {};
                }
                current = current[parts[i]];
            }
            
            current[parts[parts.length - 1]] = file;
        });
        
        return tree;
    }

    collapseAllFolders(tree, parentPath = '') {
        for (const [name, value] of Object.entries(tree)) {
            const isFile = value.path !== undefined;
            if (!isFile) {
                const folderPath = parentPath ? `${parentPath}/${name}` : name;
                this.collapsedFolders.add(folderPath);
                this.collapseAllFolders(value, folderPath);
            }
        }
    }

    renderTree(tree, level = 0, parentPath = '') {
        let html = '';
        
        for (const [name, value] of Object.entries(tree)) {
            const isFile = value.path !== undefined;
            const indent = level * 20;
            
            if (isFile) {
                const isStaged = this.stagedFiles[value.path] !== undefined;
                const isFromRepo = this.repoFiles[value.path] !== undefined;
                const isNew = isStaged && !isFromRepo;
                const isModified = isStaged && isFromRepo;
                
                html += `
                    <div class="tree-item file ${isStaged ? 'staged' : ''}" 
                         data-path="${value.path}" 
                         style="padding-left: ${indent}px">
                        <input type="checkbox" class="file-checkbox" ${this.selectedFiles.has(value.path) ? 'checked' : ''}>
                        <i data-lucide="file"></i>
                        <span>${name}</span>
                        ${isNew ? '<span class="badge badge-new">New</span>' : ''}
                        ${isModified ? '<span class="badge badge-modified">Modified</span>' : ''}
                        <button class="delete-file-btn" title="Delete file">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                `;
            } else {
                const folderPath = parentPath ? `${parentPath}/${name}` : name;
                const isCollapsed = this.collapsedFolders.has(folderPath);
                const childrenHtml = this.renderTree(value, level + 1, folderPath);
                
                html += `
                    <div class="tree-item folder ${isCollapsed ? '' : 'expanded'}" 
                         data-folder="${folderPath}"
                         style="padding-left: ${indent}px">
                        <i data-lucide="chevron-right" class="folder-icon"></i>
                        <i data-lucide="folder"></i>
                        <span>${name}</span>
                    </div>
                    <div class="tree-children ${isCollapsed ? '' : 'expanded'}">
                        ${childrenHtml}
                    </div>
                `;
            }
        }
        
        return html;
    }

    attachFileTreeListeners() {
        // File clicks
        document.querySelectorAll('.tree-item.file').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox' && !e.target.closest('.delete-file-btn')) {
                    this.previewFile(item.dataset.path);
                }
            });
        });

        // File checkboxes
        document.querySelectorAll('.file-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const path = e.target.closest('.tree-item').dataset.path;
                if (e.target.checked) {
                    this.selectedFiles.add(path);
                } else {
                    this.selectedFiles.delete(path);
                }
                this.updateSelectionCount();
            });
        });

        // Delete file buttons
        document.querySelectorAll('.delete-file-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = e.target.closest('.tree-item').dataset.path;
                this.deleteFile(path);
            });
        });

        // Folder collapse/expand
        document.querySelectorAll('.tree-item.folder').forEach(folder => {
            folder.addEventListener('click', (e) => {
                const folderPath = folder.dataset.folder;
                const children = folder.nextElementSibling;
                
                if (this.collapsedFolders.has(folderPath)) {
                    this.collapsedFolders.delete(folderPath);
                    folder.classList.add('expanded');
                    children.classList.add('expanded');
                } else {
                    this.collapsedFolders.add(folderPath);
                    folder.classList.remove('expanded');
                    children.classList.remove('expanded');
                }
                
                lucide.createIcons();
            });
        });
    }

    deleteFile(path) {
        if (!confirm(`Delete ${path}?`)) return;

        // Remove from staged files if present
        delete this.stagedFiles[path];
        
        // If it's a repo file, mark for deletion
        if (this.repoFiles[path]) {
            this.deletedFiles.add(path);
        }

        // Remove from selection
        this.selectedFiles.delete(path);

        this.renderFileTree();
        this.updateChanges();
        this.showToast('File marked for deletion', 'success');
    }

    async previewFile(path) {
        const container = document.getElementById('filePreview');
        const file = this.stagedFiles[path];

        if (!file) {
            container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="file-text"></i>
                    <p>File from repository</p>
                    <small>Preview not available for repo files yet</small>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        try {
            const content = atob(file.content);
            const isText = this.isTextFile(path);

            if (isText) {
                container.innerHTML = `
                    <div class="file-preview-header">
                        <strong>${path}</strong>
                    </div>
                    <pre class="code-preview">${this.escapeHtml(content)}</pre>
                `;
            } else {
                container.innerHTML = `
                    <div class="file-preview-header">
                        <strong>${path}</strong>
                    </div>
                    <p>Binary file - cannot preview</p>
                `;
            }
        } catch (error) {
            container.innerHTML = `<p>Error previewing file</p>`;
        }
    }

    isTextFile(path) {
        const textExtensions = ['.txt', '.md', '.js', '.json', '.html', '.css', '.xml', '.py', '.java', '.cpp', '.c', '.h'];
        return textExtensions.some(ext => path.endsWith(ext));
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============ Batch Operations ============
    selectAll() {
        this.selectedFiles.clear();
        const allFiles = { ...this.repoFiles, ...this.stagedFiles };
        Object.keys(allFiles).forEach(path => {
            if (!this.deletedFiles.has(path)) {
                this.selectedFiles.add(path);
            }
        });
        this.renderFileTree();
        this.updateSelectionCount();
    }

    deselectAll() {
        this.selectedFiles.clear();
        this.renderFileTree();
        this.updateSelectionCount();
    }

    updateSelectionCount() {
        document.getElementById('selectionCount').textContent = `${this.selectedFiles.size} selected`;
    }

    batchDelete() {
        if (this.selectedFiles.size === 0) {
            this.showToast('No files selected', 'error');
            return;
        }

        if (!confirm(`Delete ${this.selectedFiles.size} files?`)) return;

        this.selectedFiles.forEach(path => {
            // Remove from staged files if present
            delete this.stagedFiles[path];
            
            // If it's a repo file, mark for deletion
            if (this.repoFiles[path]) {
                this.deletedFiles.add(path);
            }
        });

        this.selectedFiles.clear();
        this.renderFileTree();
        this.updateChanges();
        this.showToast('Files marked for deletion', 'success');
    }

    batchRename() {
        const pattern = document.getElementById('renamePattern').value;
        const replacement = document.getElementById('renameReplacement').value;

        if (!pattern || !replacement) {
            this.showToast('Enter both pattern and replacement', 'error');
            return;
        }

        let renamedCount = 0;
        const newRepoFiles = {};
        const newStagedFiles = {};

        // Rename repo files
        Object.entries(this.repoFiles).forEach(([path, file]) => {
            if (this.selectedFiles.has(path)) {
                const newPath = path.replace(pattern, replacement);
                newRepoFiles[newPath] = { ...file, path: newPath };
                renamedCount++;
            } else {
                newRepoFiles[path] = file;
            }
        });

        // Rename staged files
        Object.entries(this.stagedFiles).forEach(([path, file]) => {
            if (this.selectedFiles.has(path)) {
                const newPath = path.replace(pattern, replacement);
                newStagedFiles[newPath] = { ...file, path: newPath };
                renamedCount++;
            } else {
                newStagedFiles[path] = file;
            }
        });

        this.repoFiles = newRepoFiles;
        this.stagedFiles = newStagedFiles;
        this.selectedFiles.clear();
        this.renderFileTree();
        this.updateChanges();
        this.showToast(`Renamed ${renamedCount} files`, 'success');
    }

    batchMove() {
        const targetFolder = document.getElementById('moveToFolder').value;

        if (!targetFolder) {
            this.showToast('Enter target folder', 'error');
            return;
        }

        let movedCount = 0;
        const newRepoFiles = {};
        const newStagedFiles = {};

        // Move repo files
        Object.entries(this.repoFiles).forEach(([path, file]) => {
            if (this.selectedFiles.has(path)) {
                const filename = path.split('/').pop();
                const newPath = `${targetFolder}/${filename}`;
                newRepoFiles[newPath] = { ...file, path: newPath };
                movedCount++;
            } else {
                newRepoFiles[path] = file;
            }
        });

        // Move staged files
        Object.entries(this.stagedFiles).forEach(([path, file]) => {
            if (this.selectedFiles.has(path)) {
                const filename = path.split('/').pop();
                const newPath = `${targetFolder}/${filename}`;
                newStagedFiles[newPath] = { ...file, path: newPath };
                movedCount++;
            } else {
                newStagedFiles[path] = file;
            }
        });

        this.repoFiles = newRepoFiles;
        this.stagedFiles = newStagedFiles;
        this.selectedFiles.clear();
        this.renderFileTree();
        this.updateChanges();
        this.showToast(`Moved ${movedCount} files`, 'success');
    }

    // ============ Push Operations ============
    updateChanges() {
        const changes = this.calculateChanges();
        
        document.getElementById('addedCount').textContent = changes.added.length;
        document.getElementById('modifiedCount').textContent = changes.modified.length;
        document.getElementById('deletedCount').textContent = changes.deleted.length;

        const container = document.querySelector('.changes-container');
        
        if (changes.added.length === 0 && changes.modified.length === 0 && changes.deleted.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary);">No changes to push</p>';
            return;
        }

        container.innerHTML = `
            ${this.renderChangesList('Added', changes.added, 'file-plus')}
            ${this.renderChangesList('Modified', changes.modified, 'file-edit')}
            ${this.renderChangesList('Deleted', changes.deleted, 'file-minus')}
        `;
        
        lucide.createIcons();
    }

    calculateChanges() {
        const changes = {
            added: [],
            modified: [],
            deleted: []
        };

        // Check staged files
        Object.keys(this.stagedFiles).forEach(path => {
            if (this.repoFiles[path]) {
                changes.modified.push(path);
            } else {
                changes.added.push(path);
            }
        });

        // Check deleted files
        this.deletedFiles.forEach(path => {
            changes.deleted.push(path);
        });

        return changes;
    }

    renderChangesList(title, files, icon) {
        if (files.length === 0) return '';

        return `
            <div class="change-group">
                <h4><i data-lucide="${icon}"></i> ${title} (${files.length})</h4>
                <ul>
                    ${files.map(file => `<li>${file}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    async pushChanges() {
        if (!this.validateConfig()) return;

        const commitMessage = document.getElementById('commitMessage').value;
        if (!commitMessage) {
            this.showToast('Enter a commit message', 'error');
            return;
        }

        const hasChanges = Object.keys(this.stagedFiles).length > 0 || this.deletedFiles.size > 0;
        if (!hasChanges) {
            this.showToast('No files to push', 'error');
            return;
        }

        this.showLoading(true);

        try {
            // Push staged files (add/modify)
            for (const [path, file] of Object.entries(this.stagedFiles)) {
                await this.pushFile(path, file, commitMessage);
            }

            // Delete files
            for (const path of this.deletedFiles) {
                await this.deleteFileFromRepo(path, commitMessage);
            }

            this.showToast('Successfully pushed all changes', 'success');
            
            // Clear staged and deleted files
            this.stagedFiles = {};
            this.deletedFiles.clear();
            
            // Re-fetch repo to get updated state
            await this.fetchRepoStructure();
        } catch (error) {
            this.showToast('Push failed: ' + error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async pushFile(path, file, message) {
        const url = `https://api.github.com/repos/${this.config.username}/${this.config.repo}/contents/${path}`;
        
        const body = {
            message: message,
            content: file.content,
            branch: this.config.branch
        };

        // If file exists in repo, include its SHA
        if (this.repoFiles[path]?.sha) {
            body.sha = this.repoFiles[path].sha;
        }

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Push failed');
        }
    }

    async deleteFileFromRepo(path, message) {
        const url = `https://api.github.com/repos/${this.config.username}/${this.config.repo}/contents/${path}`;
        
        if (!this.repoFiles[path]?.sha) {
            // File doesn't exist in repo, nothing to delete
            return;
        }

        const body = {
            message: message,
            sha: this.repoFiles[path].sha,
            branch: this.config.branch
        };

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `token ${this.config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Delete failed');
        }
    }

    // ============ Theme Management ============
    applyTheme() {
        if (this.theme === 'light') {
            document.body.classList.add('light-mode');
            const icon = document.querySelector('#themeToggle i');
            if (icon) {
                icon.setAttribute('data-lucide', 'moon');
                lucide.createIcons();
            }
        } else {
            document.body.classList.remove('light-mode');
            const icon = document.querySelector('#themeToggle i');
            if (icon) {
                icon.setAttribute('data-lucide', 'sun');
                lucide.createIcons();
            }
        }
    }

    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
    }

    // ============ Root Path Adjustment ============
    showRootAdjuster() {
        const allFiles = { ...this.repoFiles, ...this.stagedFiles };
        if (Object.keys(allFiles).length === 0) {
            this.showToast('No files to adjust. Fetch repo or upload files first.', 'error');
            return;
        }
        document.getElementById('rootAdjuster').style.display = 'block';
        this.updatePathPreview();
    }

    closeRootAdjuster() {
        document.getElementById('rootAdjuster').style.display = 'none';
    }

    updatePathPreview() {
        const operation = document.getElementById('pathOperation').value;
        const pathValue = document.getElementById('pathValue').value;
        const container = document.getElementById('pathPreview');

        if (!pathValue) {
            container.innerHTML = '<p style="color: var(--text-secondary); text-align: center;">Enter a path to see preview</p>';
            return;
        }

        const allPaths = [...Object.keys(this.repoFiles), ...Object.keys(this.stagedFiles)];
        const uniquePaths = [...new Set(allPaths)];
        
        const previews = uniquePaths.slice(0, 10).map(path => {
            const transformed = this.transformPath(path, operation, pathValue);
            return `
                <div class="path-preview-item">
                    <span class="original">${path}</span>
                    <span class="arrow">→</span>
                    <span class="transformed">${transformed}</span>
                </div>
            `;
        });

        const total = uniquePaths.length;
        container.innerHTML = previews.join('') + 
            (total > 10 ? `<p style="color: var(--text-secondary); text-align: center; margin-top: 12px;">... and ${total - 10} more files</p>` : '');
    }

    transformPath(path, operation, value) {
        if (operation === 'strip') {
            // Strip prefix
            if (path.startsWith(value)) {
                return path.substring(value.length);
            }
            return path;
        } else if (operation === 'add') {
            // Add prefix
            if (value === '../') {
                // Go up one level (remove first directory)
                const parts = path.split('/');
                return parts.slice(1).join('/');
            } else if (value === './') {
                // Current level (no change)
                return path;
            } else {
                // Add folder prefix
                return value + path;
            }
        }
        return path;
    }

    applyPathTransform() {
        const operation = document.getElementById('pathOperation').value;
        const pathValue = document.getElementById('pathValue').value;

        if (!pathValue) {
            this.showToast('Enter a path value', 'error');
            return;
        }

        let transformedCount = 0;

        // Transform repo files
        const newRepoFiles = {};
        Object.entries(this.repoFiles).forEach(([path, file]) => {
            const newPath = this.transformPath(path, operation, pathValue);
            if (newPath !== path) {
                transformedCount++;
            }
            newRepoFiles[newPath] = {
                ...file,
                path: newPath
            };
        });
        this.repoFiles = newRepoFiles;

        // Transform staged files
        const newStagedFiles = {};
        Object.entries(this.stagedFiles).forEach(([path, file]) => {
            const newPath = this.transformPath(path, operation, pathValue);
            if (newPath !== path) {
                transformedCount++;
            }
            newStagedFiles[newPath] = {
                ...file,
                path: newPath
            };
        });
        this.stagedFiles = newStagedFiles;

        // Transform deleted files
        const newDeletedFiles = new Set();
        this.deletedFiles.forEach(path => {
            const newPath = this.transformPath(path, operation, pathValue);
            newDeletedFiles.add(newPath);
        });
        this.deletedFiles = newDeletedFiles;

        this.closeRootAdjuster();
        this.renderFileTree();
        this.updateChanges();
        this.showToast(`Transformed ${transformedCount} file paths`, 'success');
    }

    // ============ Utilities ============
    validateConfig() {
        if (!this.config.token || !this.config.username || !this.config.repo) {
            this.showToast('Please configure GitHub credentials first', 'error');
            return false;
        }
        return true;
    }

    showLoading(show) {
        document.getElementById('loadingOverlay').classList.toggle('active', show);
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // ============ Event Listeners ============
    setupEventListeners() {
        // Theme toggle
        document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());

        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
            });
        });

        // Settings
        document.getElementById('saveConfig').addEventListener('click', () => this.saveConfig());
        document.getElementById('testConnection').addEventListener('click', () => this.testConnection());
        document.getElementById('fetchRepo').addEventListener('click', () => this.fetchRepoStructure());

        // Files
        document.getElementById('uploadZip').addEventListener('click', () => {
            document.getElementById('zipInput').click();
        });

        document.getElementById('zipInput').addEventListener('change', (e) => {
            if (e.target.files[0]) {
                this.handleZipUpload(e.target.files[0]);
            }
        });

        document.getElementById('fileSearch').addEventListener('input', (e) => {
            // TODO: Implement search filtering
        });

        // Root path adjuster
        document.getElementById('showRootAdjuster').addEventListener('click', () => this.showRootAdjuster());
        document.getElementById('closeAdjuster').addEventListener('click', () => this.closeRootAdjuster());
        document.getElementById('pathOperation').addEventListener('change', () => this.updatePathPreview());
        document.getElementById('pathValue').addEventListener('input', () => this.updatePathPreview());
        document.getElementById('applyPathTransform').addEventListener('click', () => this.applyPathTransform());

        // Batch operations
        document.getElementById('selectAll').addEventListener('click', () => this.selectAll());
        document.getElementById('deselectAll').addEventListener('click', () => this.deselectAll());
        document.getElementById('batchDelete').addEventListener('click', () => this.batchDelete());
        document.getElementById('batchRename').addEventListener('click', () => this.batchRename());
        document.getElementById('batchMove').addEventListener('click', () => this.batchMove());

        // Push
        document.getElementById('pushChanges').addEventListener('click', () => this.pushChanges());

        // Load config into inputs
        if (this.config.token) {
            document.getElementById('githubToken').value = this.config.token;
            document.getElementById('githubUsername').value = this.config.username;
            document.getElementById('repoName').value = this.config.repo;
            document.getElementById('branchName').value = this.config.branch;
        }
    }
}

// Initialize app
const app = new GitHubPusher();
