
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

        window[callbackName] = function (data) {
            cleanup();
            resolve(data);
        };

        script.onerror = function () {
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
            showToast(`Loaded ${links.length} links`, 'success');
        } else {
            showToast('Failed to load links from server', 'warning');
            const localResult = await getLocalFallbackData('getLinks');
            if (localResult.success) {
                links = localResult.links;
                await render();
            }
        }
    } catch (error) {
        console.error('Error fetching links:', error);
        showToast('Connection error. Using cached data.', 'warning');
        const localResult = await getLocalFallbackData('getLinks');
        if (localResult.success) {
            links = localResult.links;
            await render();
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
header.className = `
    inline-flex items-center gap-3 px-4 py-1.5 mb-6 rounded-full
    bg-gradient-to-r from-violet-100/20 to-fuchsia-100/60
    dark:from-violet-900/20 dark:to-fuchsia-900/30
    backdrop-blur-md
    ring-1 ring-white/60 dark:ring-white/10
    shadow-[0_8px_25px_rgba(139,92,246,0.25)]
    hover:shadow-[0_10px_35px_rgba(139,92,246,0.35)]
    transition-all duration-300
`;

header.innerHTML = `
    <span class="relative flex w-2.5 h-2.5">
        <span class="absolute inline-flex h-full w-full rounded-full
                     bg-violet-500 opacity-75 animate-ping"></span>
        <span class="relative inline-flex w-2.5 h-2.5 rounded-full
                     bg-violet-600"></span>
    </span>

    <h2 class="text-[11px] font-bold uppercase tracking-[0.25em]
               text-violet-700 dark:text-violet-200">
        ${groupName}
        <span class="ml-1 text-violet-500 dark:text-violet-400">
            (${groups[groupName].length})
        </span>
    </h2>
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

    const domain = extractDomain(link.url);
    const title = getWebsiteTitle(domain);
    const safeUrl = link.url.replace(/'/g, "\\'");
    const tagsHtml = (link.tags || []).map(t =>
        `<span class="px-2 py-1 bg-violet-50/80 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800/30 text-xs font-medium text-violet-600 dark:text-violet-300 rounded-md">#${t}</span>`
    ).join('');

    // Get color gradient based on domain
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

    // Get screenshot URL
    const screenshotUrl = `https://s0.wp.com/mshots/v1/${encodeURIComponent(link.url)}?w=800&h=600`;

    // Build image HTML with fallback
    const imageHtml = `
            <img src="${screenshotUrl}" alt="${title}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
            <div class="w-full h-full flex items-center justify-center bg-gradient-to-br ${fallbackColor} hidden">
                <i class="fa-solid fa-globe text-white text-3xl"></i>
            </div>
        `;

    card.innerHTML = `
            <div class="relative mb-6 overflow-hidden rounded-2xl aspect-video border border-white/20 dark:border-white/5 group-hover:border-violet-200/50 transition-colors">
                ${imageHtml}
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div class="card-actions absolute top-4 right-4 flex gap-2">
                    <button onclick="editLink('${safeUrl}')" class="w-10 h-10 rounded-full bg-white/20 dark:bg-black/80 backdrop-blur-sm text-blue-500 shadow-lg border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all" title="Edit">
                        <i class="fa-solid fa-pen text-sm"></i>
                    </button>
                    <button onclick="promptDelete('${safeUrl}')" class="w-10 h-10 rounded-full bg-white/20 dark:bg-black/80 backdrop-blur-sm text-red-500 shadow-lg border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all" title="Delete">
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
                <p class="text-stone-500 dark:text-slate-400 text-sm line-clamp-2 leading-relaxed mb-6 h-10">
                    ${getWebsiteDescription(domain)}
                </p>
            </div>

            <div class="mt-auto pt-5 border-t border-stone-100/50 dark:border-slate-700/50 flex items-center justify-between">
                <div class="flex gap-2 flex-wrap">${tagsHtml}</div>
                <div class="flex gap-2">
                    <button onclick="copyToClipboard('${safeUrl}', this)" class="w-10 h-10 rounded-xl bg-stone-100 dark:bg-slate-700 text-stone-500 dark:text-slate-400 hover:bg-violet-100 hover:text-violet-600 dark:hover:bg-violet-900/30 dark:hover:text-violet-300 transition-colors flex items-center justify-center" title="Copy">
                        <i class="fa-regular fa-copy text-sm"></i>
                    </button>
                    <a href="${link.url}" target="_blank" class="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-600 text-violet-600 dark:text-white hover:bg-violet-100 transition-all duration-300 flex items-center justify-center" title="Visit">
                        <i class="fa-solid fa-arrow-up-right-from-square text-sm"></i>
                    </a>
                </div>
            </div>
        `;

    return card;
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

function getWebsiteTitle(domain) {
    // Clean up domain for title
    const cleanDomain = domain
        .replace('.com', '')
        .replace('.org', '')
        .replace('.net', '')
        .replace('.io', '')
        .replace('.co', '')
        .replace(/-/g, ' ')
        .replace(/\.[a-z]{2,}$/, '');

    // Capitalize first letter of each word
    return cleanDomain
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function getWebsiteDescription(domain) {
    // Simple descriptions based on domain keywords
    if (domain.includes('github')) return 'Code hosting platform for version control and collaboration.';
    if (domain.includes('figma')) return 'Collaborative interface design tool.';
    if (domain.includes('tailwind')) return 'Utility-first CSS framework for rapid UI development.';
    if (domain.includes('chatgpt')) return 'AI-powered conversational assistant.';
    if (domain.includes('codepen')) return 'Online code editor and front-end developer community.';
    if (domain.includes('dribbble')) return 'Showcase and discover creative work.';
    if (domain.includes('pinterest')) return 'Visual discovery engine for finding ideas.';
    if (domain.includes('canva')) return 'Online design and publishing tool.';
    if (domain.includes('freepik')) return 'Find free vectors, stock photos, PSD and icons.';
    if (domain.includes('awwwards')) return 'Website awards platform for designers and developers.';
    if (domain.includes('brutalist')) return 'Showcase of brutalist website designs.';
    if (domain.includes('coolors')) return 'Color palette generator for designers.';
    if (domain.includes('css-tricks')) return 'Web design and development tutorials.';
    if (domain.includes('dev.to')) return 'Community of software developers.';
    if (domain.includes('excalidraw')) return 'Virtual whiteboard for sketching hand-drawn diagrams.';
    if (domain.includes('fontawesome')) return 'Icon library and toolkit.';
    if (domain.includes('lottiefiles')) return 'Platform for lightweight, scalable animations.';
    if (domain.includes('mdn')) return 'Web technology reference for developers.';
    if (domain.includes('npmjs')) return 'Package manager for JavaScript.';
    if (domain.includes('roadmap')) return 'Developer roadmaps and learning paths.';
    if (domain.includes('undraw')) return 'Open-source illustrations for projects.';
    if (domain.includes('vscode')) return 'Code editor redefined and optimized for building and debugging.';
    if (domain.includes('w3schools')) return 'Web development tutorials and references.';

    return `Visit ${domain} for more information.`;
}

// --- Login Modal Functions ---
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

// --- Add Link Modal Functions ---
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
        showToast('Link added successfully', 'success');
    } else {
        showToast('Failed to add link. Please try again.', 'error');
    }
});

// --- Edit Link Modal Functions ---
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
            showToast('Link updated successfully', 'success');
        } else {
            showToast('Failed to update link. Please try again.', 'error');
        }
    }
});

// --- Delete Modal Functions ---
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

    toast.className = `pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-lg shadow-xl backdrop-blur-sm transform transition-all duration-300 ${colors}`;
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
