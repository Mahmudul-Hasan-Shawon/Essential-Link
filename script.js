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
    
    // Cache for metadata (with longer TTL)
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
                
                // Load metadata with longer delay to avoid rate limiting
                setTimeout(() => {
                    loadAllMetadata();
                }, 2000); // Wait 2 seconds before starting metadata fetch
                
                showToast(`Loaded ${links.length} links`, 'success');
            } else {
                showToast('Failed to load links from server', 'warning');
                const localResult = await getLocalFallbackData('getLinks');
                if (localResult.success) {
                    links = localResult.links;
                    await render();
                    setTimeout(() => loadAllMetadata(), 2000);
                }
            }
        } catch (error) {
            console.error('Error fetching links:', error);
            showToast('Connection error. Using cached data.', 'warning');
            const localResult = await getLocalFallbackData('getLinks');
            if (localResult.success) {
                links = localResult.links;
                await render();
                setTimeout(() => loadAllMetadata(), 2000);
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
                const card = createLinkCardSkeleton(link);
                grid.appendChild(card);
                card.dataset.url = link.url;
                card.dataset.loaded = 'false';
            }
            
            section.appendChild(grid);
            container.appendChild(section);
        }
    }

    function createLinkCardSkeleton(link) {
        const card = document.createElement('div');
        card.className = 'glass-card rounded-3xl p-6 relative group h-full opacity-0';
        card.style.animation = `slideUp 0.5s ease-out forwards`;
        
        const domain = extractDomain(link.url);
        const safeUrl = link.url.replace(/'/g, "\\'");
        const tagsHtml = (link.tags || []).map(t => 
            `<span class="px-2 py-1 bg-violet-50/80 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/30 text-xs font-medium text-violet-600 dark:text-violet-300 rounded-md">#${t}</span>`
        ).join('');
        
        card.innerHTML = `
            <div class="relative mb-6 overflow-hidden rounded-2xl aspect-video bg-gradient-to-br from-violet-50 to-white dark:from-slate-800 dark:to-slate-900 border border-white/20 dark:border-white/5 group-hover:border-violet-200/50 transition-colors flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                    <i class="fa-solid fa-globe text-violet-300 dark:text-violet-700 text-xl"></i>
                </div>
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
                        <div class="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                            <i class="fa-solid fa-link text-violet-400 dark:text-violet-500 text-xs"></i>
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold text-stone-900 dark:text-white leading-snug tracking-tight truncate" title="${domain}">${domain}</h3>
                        <p class="text-stone-500 dark:text-slate-400 text-xs mt-1 truncate" title="${link.url}">${extractDomain(link.url)}</p>
                    </div>
                </div>
                <p class="text-stone-500 dark:text-slate-400 text-sm line-clamp-2 leading-relaxed mb-6 h-10 italic">Loading description...</p>
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
        const cards = Array.from(container.querySelectorAll('.glass-card[data-loaded="false"]'));
        
        // Shuffle cards to avoid sequential requests to same domain
        const shuffledCards = cards.sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < shuffledCards.length; i++) {
            const card = shuffledCards[i];
            const url = card.dataset.url;
            
            if (url) {
                // Increase delay between requests to avoid rate limiting
                setTimeout(async () => {
                    await updateCardWithMetadata(card, url);
                }, i * 1000); // 1 second between requests
            }
        }
    }

    async function updateCardWithMetadata(card, url) {
        try {
            const meta = await fetchMetaWithFallback(url);
            const domain = extractDomain(url);
            const title = meta.title || domain;
            
            // Use a better favicon service that doesn't 404
            const logoUrl = `https://icon.horse/icon/${domain}`;
            
            const imgContainer = card.querySelector('div[class*="aspect-video"]');
            if (imgContainer && meta.image && meta.image.url) {
                imgContainer.innerHTML = `
                    <img src="${meta.image.url}" alt="${title}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                    <div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-50 to-white dark:from-slate-800 dark:to-slate-900 hidden">
                        <i class="fa-solid fa-globe text-3xl text-violet-200 dark:text-slate-600"></i>
                    </div>
                    <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    ${imgContainer.querySelector('.card-actions').outerHTML}
                `;
            }
            
            const titleContainer = card.querySelector('.flex-1.min-w-0');
            if (titleContainer) {
                titleContainer.innerHTML = `
                    <h3 class="text-lg font-bold text-stone-900 dark:text-white leading-snug tracking-tight truncate" title="${title}">${title}</h3>
                    <p class="text-stone-500 dark:text-slate-400 text-xs mt-1 truncate" title="${url}">${extractDomain(url)}</p>
                `;
            }
            
            const descContainer = card.querySelector('p[class*="line-clamp-2"]');
            if (descContainer) {
                descContainer.textContent = meta.description || 'No description available.';
                descContainer.classList.remove('italic');
            }
            
            const faviconContainer = card.querySelector('div[class*="rounded-full"]:first-child');
            if (faviconContainer) {
                faviconContainer.innerHTML = `
                    <img src="${logoUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" class="w-6 h-6 object-contain">
                    <div class="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center hidden">
                        <i class="fa-solid fa-link text-violet-400 dark:text-violet-500 text-xs"></i>
                    </div>
                `;
            }
            
            card.dataset.loaded = 'true';
            
        } catch (error) {
            console.log('Failed to load metadata for:', url, error);
            card.dataset.loaded = 'true'; // Mark as loaded even if failed
        }
    }

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

    async function fetchMetaWithFallback(url) {
        // Check cache first
        if (metaCache.has(url)) {
            const cached = metaCache.get(url);
            if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) { // 24 hour cache
                return cached.data;
            }
        }
        
        const domain = extractDomain(url);
        const defaultMeta = {
            title: domain,
            description: 'Visit website for details.',
            image: null
        };
        
        // Try multiple metadata sources with fallbacks
        try {
            // Option 1: Simple title fetch without external API
            const meta = await fetchSimpleMetadata(url);
            metaCache.set(url, { data: meta, timestamp: Date.now() });
            return meta;
            
        } catch (error) {
            console.log('Metadata fetch failed for:', url, error);
            metaCache.set(url, { data: defaultMeta, timestamp: Date.now() });
            return defaultMeta;
        }
    }

    async function fetchSimpleMetadata(url) {
        const domain = extractDomain(url);
        
        // For popular websites, use predefined metadata
        const knownSites = {
            'tailwindcss.com': {
                title: 'Tailwind CSS',
                description: 'A utility-first CSS framework for rapidly building custom designs.',
                image: 'https://tailwindcss.com/_next/static/media/tailwindui-small@75.8bb955b2.jpg'
            },
            'github.com': {
                title: 'GitHub',
                description: 'GitHub is where over 100 million developers shape the future of software.',
                image: 'https://github.githubassets.com/images/modules/open_graph/github-mark.png'
            },
            'figma.com': {
                title: 'Figma',
                description: 'Figma is a collaborative web application for interface design.',
                image: 'https://static.figma.com/uploads/0c76b6299d8c86c4155f30d7e0b67cf17f64b6c3'
            },
            'chatgpt.com': {
                title: 'ChatGPT',
                description: 'An AI-powered conversational assistant by OpenAI.',
                image: 'https://chatgpt.com/share/images/share-1.png'
            },
            'codepen.io': {
                title: 'CodePen',
                description: 'An online community for testing and showcasing HTML, CSS and JavaScript code snippets.',
                image: 'https://cpwebassets.codepen.io/assets/social/facebook-default.png'
            },
            'awwwards.com': {
                title: 'Awwwards',
                description: 'Website awards recognizing the talent of web designers and developers.',
                image: 'https://assets.awwwards.com/assets/images/og-image.jpg'
            },
            'dribbble.com': {
                title: 'Dribbble',
                description: 'Discover the world\'s top designers and creative professionals.',
                image: 'https://cdn.dribbble.com/assets/dribbble-ball-192-ec064e49e6b62b4a7c7929c15c26d4a9.png'
            }
        };
        
        // Check if we have predefined metadata
        for (const [site, meta] of Object.entries(knownSites)) {
            if (url.includes(site)) {
                return meta;
            }
        }
        
        // For other sites, return basic info
        return {
            title: domain.charAt(0).toUpperCase() + domain.slice(1).replace('.com', ''),
            description: `Visit ${domain} for more information.`,
            image: null
        };
    }

    // --- Modal Functions ---
    const loginModal = document.getElementById('loginModal');
    const loginBackdrop = document.getElementById('loginModalBackdrop');
    const loginContent = document.getElementById('loginModalContent');

    function openLoginModal() {
        loginModal.classList.remove('hidden');
        setTimeout(() => {
            loginBackdrop.classList.remove('opacity-0');
            loginContent.classList.remove('scale-95', 'opacity-0');
            loginContent.classList.add('scale-100', 'opacity-100');
        }, 10);
        document.getElementById('loginId').focus();
    }

    function closeLoginModal() {
        loginBackdrop.classList.add('opacity-0');
        loginContent.classList.remove('scale-100', 'opacity-100');
        loginContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            loginModal.classList.add('hidden');
            document.getElementById('loginForm').reset();
        }, 300);
    }

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const idInput = document.getElementById('loginId').value;
        const passInput = document.getElementById('loginPass').value;

        if (!idInput || !passInput) {
            showToast('Please enter ID and password', 'error');
            return;
        }

        showToast('Verifying credentials...', 'info');
        
        if (await verifyLogin(idInput, passInput)) {
            closeLoginModal();
            enableEditMode();
        } else {
            showToast('Invalid ID or Password', 'error');
            const content = document.getElementById('loginModalContent');
            content.classList.add('translate-x-[-10px]');
            setTimeout(() => {
                content.classList.remove('translate-x-[-10px]');
                content.classList.add('translate-x-[10px]');
                setTimeout(() => {
                    content.classList.remove('translate-x-[10px]');
                }, 100);
            }, 100);
        }
    });

    const modal = document.getElementById('modal');
    const backdrop = document.getElementById('modalBackdrop');
    const modalContent = document.getElementById('modalContent');

    function openModal() {
        modal.classList.remove('hidden');
        setTimeout(() => {
            backdrop.classList.remove('opacity-0');
            modalContent.classList.remove('scale-95', 'opacity-0');
            modalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
        document.getElementById('urlInput').focus();
    }

    function closeModal() {
        backdrop.classList.add('opacity-0');
        modalContent.classList.remove('scale-100', 'opacity-100');
        modalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            document.getElementById('addForm').reset();
        }, 300);
    }

    document.getElementById('addForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = document.getElementById('urlInput').value;
        const group = document.getElementById('groupInput').value;
        const tags = document.getElementById('tagsInput').value.split(',').map(t => t.trim()).filter(Boolean).join(',');
        
        if (!isValidUrl(url)) {
            showToast('Please enter a valid URL', 'error');
            return;
        }
        
        if (!group) {
            showToast('Please select a group', 'error');
            return;
        }
        
        showToast('Adding link...', 'info');
        
        if (await addLinkToSheet(url, group, tags)) {
            links.unshift({ 
                url: url, 
                group: group, 
                tags: tags.split(',').map(t => t.trim()).filter(Boolean) 
            });
            
            localStorage.setItem('essentialLinks_data', JSON.stringify({ 
                links: links, 
                timestamp: new Date().toISOString() 
            }));
            
            metaCache.delete(url);
            
            closeModal();
            await render();
            setTimeout(() => loadAllMetadata(), 2000);
            showToast('Link added successfully', 'success');
        } else {
            showToast('Failed to add link. Please try again.', 'error');
        }
    });

    const editModal = document.getElementById('editModal');
    const editBackdrop = document.getElementById('editModalBackdrop');
    const editModalContent = document.getElementById('editModalContent');

    function openEditModal() {
        editModal.classList.remove('hidden');
        setTimeout(() => {
            editBackdrop.classList.remove('opacity-0');
            editModalContent.classList.remove('scale-95', 'opacity-0');
            editModalContent.classList.add('scale-100', 'opacity-100');
        }, 10);
        document.getElementById('editUrlInput').focus();
    }

    function closeEditModal() {
        editBackdrop.classList.add('opacity-0');
        editModalContent.classList.remove('scale-100', 'opacity-100');
        editModalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            editModal.classList.add('hidden');
            document.getElementById('editForm').reset();
            currentEditIndex = -1;
        }, 300);
    }

    function editLink(url) {
        const linkIndex = links.findIndex(l => l.url === url);
        if (linkIndex !== -1) {
            currentEditIndex = linkIndex;
            const link = links[linkIndex];
            document.getElementById('editUrlInput').value = link.url;
            document.getElementById('editGroupInput').value = link.group;
            document.getElementById('editTagsInput').value = (link.tags || []).join(', ');
            openEditModal();
        }
    }

    document.getElementById('editForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (currentEditIndex !== -1) {
            const oldUrl = links[currentEditIndex].url;
            const newUrl = document.getElementById('editUrlInput').value;
            const group = document.getElementById('editGroupInput').value;
            const tags = document.getElementById('editTagsInput').value.split(',').map(t => t.trim()).filter(Boolean).join(',');
            
            if (!isValidUrl(newUrl)) {
                showToast('Please enter a valid URL', 'error');
                return;
            }
            
            if (!group) {
                showToast('Please select a group', 'error');
                return;
            }
            
            showToast('Updating link...', 'info');
            
            if (await updateLinkInSheet(oldUrl, newUrl, group, tags)) {
                links[currentEditIndex] = { 
                    url: newUrl, 
                    group: group, 
                    tags: tags.split(',').map(t => t.trim()).filter(Boolean) 
                };
                
                localStorage.setItem('essentialLinks_data', JSON.stringify({ 
                    links: links, 
                    timestamp: new Date().toISOString() 
                }));
                
                metaCache.delete(oldUrl);
                metaCache.delete(newUrl);
                
                closeEditModal();
                await render();
                setTimeout(() => loadAllMetadata(), 2000);
                showToast('Link updated successfully', 'success');
            } else {
                showToast('Failed to update link. Please try again.', 'error');
            }
        }
    });

    const deleteModal = document.getElementById('deleteModal');
    const deleteBackdrop = document.getElementById('deleteModalBackdrop');
    const deleteContent = document.getElementById('deleteModalContent');

    function promptDelete(url) {
        urlToDelete = url;
        deleteModal.classList.remove('hidden');
        setTimeout(() => {
            deleteBackdrop.classList.remove('opacity-0');
            deleteContent.classList.remove('scale-95', 'opacity-0');
            deleteContent.classList.add('scale-100', 'opacity-100');
        }, 10);
    }

    function closeDeleteModal() {
        deleteBackdrop.classList.add('opacity-0');
        deleteContent.classList.remove('scale-100', 'opacity-100');
        deleteContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            deleteModal.classList.add('hidden');
            urlToDelete = null;
        }, 300);
    }

    async function confirmDelete() {
        if (urlToDelete) {
            showToast('Deleting link...', 'info');
            
            if (await deleteLinkFromSheet(urlToDelete)) {
                links = links.filter(l => l.url !== urlToDelete);
                localStorage.setItem('essentialLinks_data', JSON.stringify({ 
                    links: links, 
                    timestamp: new Date().toISOString() 
                }));
                metaCache.delete(urlToDelete);
                closeDeleteModal();
                await render();
                showToast('Link deleted successfully', 'error');
            } else {
                showToast('Failed to delete link. Please try again.', 'error');
                closeDeleteModal();
            }
        }
    }

    // --- Filter and Search Functions ---
    document.getElementById('clearSearch').addEventListener('click', () => {
        document.getElementById('searchInput').value = '';
        document.getElementById('searchInput').focus();
        render();
    });

    const dropdownWrapper = document.getElementById('dropdownWrapper');
    const dropdownMenu = document.getElementById('dropdownMenu');
    const chevron = document.getElementById('chevron');

    function toggleDropdown() {
        const isHidden = dropdownMenu.classList.contains('hidden');
        if (isHidden) {
            dropdownMenu.classList.remove('hidden');
            requestAnimationFrame(() => {
                dropdownMenu.classList.remove('dropdown-hidden');
                dropdownMenu.classList.add('dropdown-visible');
                chevron.style.transform = 'rotate(180deg)';
            });
        } else {
            dropdownMenu.classList.remove('dropdown-visible');
            dropdownMenu.classList.add('dropdown-hidden');
            chevron.style.transform = 'rotate(0deg)';
            setTimeout(() => {
                if (dropdownMenu.classList.contains('dropdown-hidden')) {
                    dropdownMenu.classList.add('hidden');
                }
            }, 200);
        }
    }

    function setFilter(val) {
        currentFilter = val;
        document.getElementById('currentFilter').textContent = val === '' ? 'All' : val;
        toggleDropdown();
        render();
    }

    function resetFilters() {
        document.getElementById('searchInput').value = '';
        setFilter('');
    }

    window.addEventListener('click', (e) => {
        if (!dropdownWrapper.contains(e.target)) {
            if (!dropdownMenu.classList.contains('hidden')) {
                dropdownMenu.classList.remove('dropdown-visible');
                dropdownMenu.classList.add('dropdown-hidden');
                chevron.style.transform = 'rotate(0deg)';
                setTimeout(() => {
                    if (dropdownMenu.classList.contains('dropdown-hidden')) {
                        dropdownMenu.classList.add('hidden');
                    }
                }, 200);
            }
        }
    });

    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            render();
        }, 300);
    });

    // --- Utility Functions ---
    function isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    function copyToClipboard(text, btnElement) {
        navigator.clipboard.writeText(text).then(() => {
            const icon = btnElement.querySelector('i');
            const originalClass = icon.className;
            icon.className = 'fa-solid fa-check text-sm text-emerald-500';
            setTimeout(() => {
                icon.className = originalClass;
            }, 1500);
            showToast('Copied to clipboard', 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            showToast('Failed to copy', 'error');
        });
    }

    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        
        let colors = '';
        let icon = '';
        
        if (type === 'success') {
            colors = 'bg-white/90 dark:bg-slate-800/90 border-l-4 border-emerald-500 text-stone-800 dark:text-white';
            icon = '<i class="fa-solid fa-check-circle text-emerald-500"></i>';
        } else if (type === 'error') {
            colors = 'bg-white/90 dark:bg-slate-800/90 border-l-4 border-red-500 text-stone-800 dark:text-white';
            icon = '<i class="fa-solid fa-circle-exclamation text-red-500"></i>';
        } else if (type === 'warning') {
            colors = 'bg-white/90 dark:bg-slate-800/90 border-l-4 border-amber-500 text-stone-800 dark:text-white';
            icon = '<i class="fa-solid fa-triangle-exclamation text-amber-500"></i>';
        } else {
            colors = 'bg-white/90 dark:bg-slate-800/90 border-l-4 border-violet-500 text-stone-800 dark:text-white';
            icon = '<i class="fa-solid fa-circle-info text-violet-500"></i>';
        }

        toast.className = `pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-lg shadow-xl backdrop-blur-md transform transition-all duration-300 ${colors}`;
        toast.style.animation = 'slideUp 0.3s ease-out forwards';
        
        toast.innerHTML = `
            ${icon}
            <span class="text-xs font-medium">${message}</span>
        `;

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function toggleTheme() {
        document.documentElement.classList.toggle('dark');
        localStorage.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }

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