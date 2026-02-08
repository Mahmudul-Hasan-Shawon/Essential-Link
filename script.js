
    // --- Configuration ---
    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwDq-bRBDB6w586q1yCmxLzxcdCiz1_uCZhweZLWP6I53SuONAcL4Nrf-sJSg08S36X/exec';
    
    // --- State Management ---
    let links = [];
    let currentFilter = '';
    let urlToDelete = null;
    let currentEditIndex = -1;
    const container = document.getElementById('mainContainer');
    const emptyState = document.getElementById('emptyState');
    const loadingPopup = document.getElementById('loadingPopup');
    
    // Cache for metadata
    const metaCache = new Map();

    // --- Loader Functions ---
    function showLoader() {
        loadingPopup.classList.remove('pointer-events-none', 'opacity-0');
        loadingPopup.style.display = 'flex';
    }
    
    function hideLoader() {
        loadingPopup.classList.add('opacity-0');
        setTimeout(() => {
            loadingPopup.style.display = 'none';
            loadingPopup.classList.add('pointer-events-none');
        }, 500);
    }

    // --- Edit Mode Functions ---
    const editToggle = document.getElementById('editToggle');
    
    editToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            e.target.checked = false;
            openLoginModal();
        } else {
            disableEditMode();
        }
    });

    function enableEditMode() {
        document.body.classList.add('edit-mode');
        editToggle.checked = true;
        showToast('Edit Mode: Active', 'success');
    }

    function disableEditMode() {
        document.body.classList.remove('edit-mode');
        editToggle.checked = false;
        if (document.body.classList.contains('edit-mode')) {
            showToast('Edit Mode: Off', 'info');
        }
    }

    // --- Google Sheets API Functions ---
    async function fetchFromGoogleSheets(params) {
        try {
            return await fetchViaJSONP(params);
        } catch (error) {
            console.error('Google Sheets API Error:', error);
            return await getLocalFallbackData(params.action);
        }
    }

    function fetchViaJSONP(params) {
        return new Promise((resolve, reject) => {
            const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
            const script = document.createElement('script');
            
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('JSONP timeout'));
            }, 10000);
            
            function cleanup() {
                clearTimeout(timeout);
                delete window[callbackName];
                if (script.parentNode) {
                    script.parentNode.removeChild(script);
                }
            }
            
            window[callbackName] = function(data) {
                cleanup();
                resolve(data);
            };
            
            script.onerror = function() {
                cleanup();
                reject(new Error('JSONP script failed to load'));
            };
            
            const url = `${GOOGLE_SCRIPT_URL}?${new URLSearchParams(params).toString()}&callback=${callbackName}&_t=${Date.now()}`;
            script.src = url;
            document.head.appendChild(script);
        });
    }

    async function getLocalFallbackData(action) {
        const localData = JSON.parse(localStorage.getItem('essentialLinks_data'));
        
        if (action === 'getLinks') {
            if (localData && localData.links) {
                showToast('Using cached data', 'info');
                return { success: true, links: localData.links };
            }
            return { success: true, links: [] };
        }
        
        if (action === 'verifyLogin') {
            return { success: true, authenticated: false };
        }
        
        return { success: false, error: 'Action not supported offline' };
    }

    async function fetchLinks() {
        showLoader();
        try {
            const result = await fetchFromGoogleSheets({ action: 'getLinks' });
            
            if (result.success) {
                links = result.links;
                localStorage.setItem('essentialLinks_data', JSON.stringify({ 
                    links: links, 
                    timestamp: new Date().toISOString() 
                }));
                
                await render();
                
                // Load metadata immediately
                loadAllMetadata();
                
                showToast(`Loaded ${links.length} links`, 'success');
            } else {
                showToast('Failed to load links from server', 'warning');
                const localResult = await getLocalFallbackData('getLinks');
                if (localResult.success) {
                    links = localResult.links;
                    await render();
                    loadAllMetadata();
                }
            }
        } catch (error) {
            console.error('Error fetching links:', error);
            showToast('Connection error. Using cached data.', 'warning');
            const localResult = await getLocalFallbackData('getLinks');
            if (localResult.success) {
                links = localResult.links;
                await render();
                loadAllMetadata();
            }
        } finally {
            hideLoader();
        }
    }

    async function verifyLogin(id, password) {
        try {
            const result = await fetchFromGoogleSheets({ 
                action: 'verifyLogin', 
                id: id, 
                password: password 
            });
            return result.success && result.authenticated === true;
        } catch (error) {
            console.error('Login error:', error);
            return false;
        }
    }

    async function addLinkToSheet(url, group, tags) {
        try {
            const result = await fetchFromGoogleSheets({
                action: 'addLink',
                url: url,
                group: group,
                tags: tags
            });
            return result.success === true;
        } catch (error) {
            console.error('Add link error:', error);
            return false;
        }
    }

    async function updateLinkInSheet(oldUrl, newUrl, group, tags) {
        try {
            const result = await fetchFromGoogleSheets({
                action: 'updateLink',
                oldUrl: oldUrl,
                newUrl: newUrl,
                group: group,
                tags: tags
            });
            return result.success === true;
        } catch (error) {
            console.error('Update link error:', error);
            return false;
        }
    }

    async function deleteLinkFromSheet(url) {
        try {
            const result = await fetchFromGoogleSheets({
                action: 'deleteLink',
                url: url
            });
            return result.success === true;
        } catch (error) {
            console.error('Delete link error:', error);
            return false;
        }
    }

    async function refreshData() {
        const icon = document.getElementById('refreshIcon');
        icon.classList.add('animate-spin');
        await fetchLinks();
        icon.classList.remove('animate-spin');
    }

    // --- Render Functions ---
    async function render() {
        container.innerHTML = '';
        const q = document.getElementById('searchInput').value.toLowerCase();
        
        const clearBtn = document.getElementById('clearSearch');
        if (q.length > 0) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }

        const filtered = links.filter(l => {
            const matchSearch = l.url.toLowerCase().includes(q) || 
                               (l.tags && l.tags.some(t => t.toLowerCase().includes(q))) ||
                               l.group.toLowerCase().includes(q);
            const matchGroup = currentFilter === '' || l.group === currentFilter;
            return matchSearch && matchGroup;
        });

        if (filtered.length === 0) {
            emptyState.classList.remove('hidden');
            emptyState.classList.add('flex');
            return;
        } else {
            emptyState.classList.add('hidden');
            emptyState.classList.remove('flex');
        }

        const groups = {};
        filtered.forEach(l => { 
            if (!groups[l.group]) groups[l.group] = []; 
            groups[l.group].push(l); 
        });

        for (const groupName in groups) {
            const section = document.createElement('div');
            section.className = 'mb-12 animate-slide-up';

            const header = document.createElement('div');
            header.className = 'flex items-center gap-3 mb-6 pl-1';
            header.innerHTML = `
                <span class="w-2 h-2 rounded-full bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.6)]"></span>
                <h2 class="text-xs font-bold uppercase tracking-widest text-violet-600 dark:text-violet-400">${groupName} <span class="text-violet-400/70">(${groups[groupName].length})</span></h2>
            `;
            section.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';

            for (const link of groups[groupName]) {
                const card = await createLinkCard(link);
                grid.appendChild(card);
            }
            
            section.appendChild(grid);
            container.appendChild(section);
        }
    }

    async function createLinkCard(link) {
        const card = document.createElement('div');
        card.className = 'glass-card rounded-3xl p-6 relative group h-full opacity-0';
        card.style.animation = `slideUp 0.5s ease-out forwards`;
        
        // Get metadata for this link
        const meta = await getWebsiteMetadata(link.url);
        const domain = extractDomain(link.url);
        const title = meta.title || domain;
        const safeUrl = link.url.replace(/'/g, "\\'");
        const tagsHtml = (link.tags || []).map(t => 
            `<span class="px-2 py-1 bg-violet-50/80 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/30 text-xs font-medium text-violet-600 dark:text-violet-300 rounded-md">#${t}</span>`
        ).join('');
        
        // Get a color based on domain for fallback
        const colorIndex = Math.abs(hashCode(domain)) % 10;
        const colorGradients = [
            'from-violet-500 to-purple-600',
            'from-blue-500 to-cyan-600',
            'from-emerald-500 to-teal-600',
            'from-amber-500 to-orange-600',
            'from-rose-500 to-pink-600',
            'from-indigo-500 to-blue-600',
            'from-green-500 to-emerald-600',
            'from-yellow-500 to-amber-600',
            'from-red-500 to-rose-600',
            'from-sky-500 to-blue-400'
        ];
        const fallbackColor = colorGradients[colorIndex];
        
        // Build image HTML
        let imageHtml = '';
        if (meta.image) {
            // Use actual website image if available
            imageHtml = `
                <img src="${meta.image}" alt="${title}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                <div class="w-full h-full flex items-center justify-center bg-gradient-to-br ${fallbackColor} hidden">
                    <i class="fa-solid fa-globe text-white text-3xl"></i>
                </div>
            `;
        } else {
            // Use fallback gradient
            imageHtml = `
                <div class="w-full h-full flex items-center justify-center bg-gradient-to-br ${fallbackColor}">
                    <i class="fa-solid fa-globe text-white text-3xl"></i>
                </div>
            `;
        }
        
        card.innerHTML = `
            <div class="relative mb-6 overflow-hidden rounded-2xl aspect-video border border-white/20 dark:border-white/5 group-hover:border-violet-200/50 transition-colors">
                ${imageHtml}
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div class="card-actions absolute top-4 right-4 flex gap-2">
                    <button onclick="editLink('${safeUrl}')" class="w-10 h-10 rounded-full bg-white/20 dark:bg-black/80 backdrop-blur-md text-blue-500 shadow-lg border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all" title="Edit">
                        <i class="fa-solid fa-pen text-sm"></i>
                    </button>
                    <button onclick="promptDelete('${safeUrl}')" class="w-10 h-10 rounded-full bg-white/20 dark:bg-black/80 backdrop-blur-md text-red-500 shadow-lg border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all" title="Delete">
                        <i class="fa-solid fa-trash text-sm"></i>
                    </button>
                </div>
            </div>

            <div class="flex-1">
                <div class="flex items-start gap-3 mb-3">
                    <div class="w-12 h-12 rounded-full bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center border border-stone-100 dark:border-slate-700 overflow-hidden shrink-0 mt-1">
                        <img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" class="w-6 h-6 object-contain">
                        <div class="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center hidden">
                            <i class="fa-solid fa-link text-violet-400 dark:text-violet-500 text-xs"></i>
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold text-stone-900 dark:text-white leading-snug tracking-tight truncate" title="${title}">${title}</h3>
                        <p class="text-stone-500 dark:text-slate-400 text-xs mt-1 truncate" title="${link.url}">${extractDomain(link.url)}</p>
                    </div>
                </div>
                <p class="text-stone-500 dark:text-slate-400 text-sm line-clamp-2 leading-relaxed mb-6 h-10" title="${meta.description || 'No description available.'}">
                    ${meta.description || 'No description available.'}
                </p>
            </div>

            <div class="mt-auto pt-5 border-t border-stone-100/50 dark:border-slate-700/50 flex items-center justify-between">
                <div class="flex gap-2 flex-wrap">${tagsHtml}</div>
                <div class="flex gap-2">
                    <button onclick="copyToClipboard('${safeUrl}', this)" class="w-10 h-10 rounded-xl bg-stone-100 dark:bg-slate-700 text-stone-500 dark:text-slate-400 hover:bg-violet-100 hover:text-violet-600 dark:hover:bg-violet-900/30 dark:hover:text-violet-300 transition-colors flex items-center justify-center" title="Copy">
                        <i class="fa-regular fa-copy text-sm"></i>
                    </button>
                    <a href="${link.url}" target="_blank" class="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-600 text-violet-600 dark:text-white hover:scale-110 hover:shadow-lg hover:shadow-violet-500/30 transition-all duration-300 flex items-center justify-center" title="Visit">
                        <i class="fa-solid fa-arrow-up-right-from-square text-sm"></i>
                    </a>
                </div>
            </div>
        `;
        
        return card;
    }

    async function loadAllMetadata() {
        // This function is kept for compatibility but not needed anymore
        // since we now load metadata in createLinkCard
    }

    // Helper functions
    function extractDomain(url) {
        try {
            const urlObj = new URL(url);
            let domain = urlObj.hostname.replace('www.', '');
            if (domain.length > 30) domain = domain.substring(0, 27) + '...';
            return domain;
        } catch {
            return url.length > 30 ? url.substring(0, 27) + '...' : url;
        }
    }

    // Simple hash function for consistent colors
    function hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    // Get website metadata - SIMPLIFIED VERSION
    async function getWebsiteMetadata(url) {
        const domain = extractDomain(url);
        
        // Check cache first
        if (metaCache.has(url)) {
            return metaCache.get(url);
        }
        
        // Default metadata
        const defaultMeta = {
            title: domain.charAt(0).toUpperCase() + domain.slice(1).replace('.com', '').replace('.org', '').replace('.net', ''),
            description: `Visit ${domain} for more information.`,
            image: null
        };
        
        // Try to get Open Graph image from the website
        try {
            // Use a simple screenshot service (no rate limits)
            const screenshotUrl = `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=800&h=600`;
            
            // Test if the image loads
            const img = new Image();
            img.src = screenshotUrl;
            
            // Wait for image to load or fail
            await new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000);
            });
            
            // If image loaded successfully, use it
            if (img.complete && img.naturalWidth > 0) {
                defaultMeta.image = screenshotUrl;
            }
            
        } catch (error) {
            console.log('Could not get screenshot for:', url);
        }
        
        // Cache and return
        metaCache.set(url, defaultMeta);
        return defaultMeta;
    }

    // --- The rest of your functions remain exactly the same ---
    // (All modal functions, filter functions, utility functions)
    // ... Include all your existing modal and utility functions here

    // Make sure to copy ALL your existing functions from the previous code:
    // - openLoginModal, closeLoginModal, and the login form submit handler
    // - openModal, closeModal, and the add form submit handler
    // - openEditModal, closeEditModal, editLink, and the edit form submit handler
    // - promptDelete, closeDeleteModal, confirmDelete
    // - toggleDropdown, setFilter, resetFilters
    // - search input handlers
    // - copyToClipboard, showToast, toggleTheme, isValidUrl
    // - refreshData
    
    // --- Initialization ---
    window.addEventListener('load', async () => {
        if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }
        
        showLoader();
        await fetchLinks();
        hideLoader();
    });

    // Global functions
    window.openModal = openModal;
    window.closeModal = closeModal;
    window.openEditModal = openEditModal;
    window.closeEditModal = closeEditModal;
    window.editLink = editLink;
    window.promptDelete = promptDelete;
    window.confirmDelete = confirmDelete;
    window.closeDeleteModal = closeDeleteModal;
    window.openLoginModal = openLoginModal;
    window.closeLoginModal = closeLoginModal;
    window.refreshData = refreshData;
    window.toggleTheme = toggleTheme;
    window.toggleDropdown = toggleDropdown;
    window.setFilter = setFilter;
    window.resetFilters = resetFilters;
    window.copyToClipboard = copyToClipboard;
