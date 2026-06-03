(() => {
    let currentUser = null;
    let currentProfile = null;

    let cachedUsers = [];
    let cachedProperties = [];

    const usersList = document.getElementById('admin-users-list');
    const propertiesList = document.getElementById('admin-properties-list');
    const negotiationsList = document.getElementById('admin-negotiations-list');
    const leasesList = document.getElementById('admin-leases-list');
    const reportSummary = document.getElementById('admin-report-summary');

    const adminUserSearch = document.getElementById('admin-user-search');
    const adminRoleFilter = document.getElementById('admin-role-filter');
    const adminStatusFilter = document.getElementById('admin-status-filter');

    const adminPropertySearch = document.getElementById('admin-property-search');
    const adminPropertyStatusFilter = document.getElementById('admin-property-status-filter');

    const profileMenuBtn = document.getElementById('profile-menu-btn');
    const profileMenuPanel = document.getElementById('profile-menu-panel');
    const profileMenuName = document.getElementById('profile-menu-name');
    const profileMenuRole = document.getElementById('profile-menu-role');
    const profileMenuViewProfile = document.getElementById('profile-menu-view-profile');
    const profileMenuAccountSettings = document.getElementById('profile-menu-account-settings');
    const profileMenuLogout = document.getElementById('profile-menu-logout');

    document.addEventListener('DOMContentLoaded', () => {
        bindNavigation();
        bindProfileMenu();
        bindProfileForm();
        bindPrintReport();
        bindRefresh();
        bindAdminFilters();
        initAdminDashboard();
    });

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value ?? '0';
    }

    function formatMoney(value) {
        return Number(value || 0).toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatDate(value) {
        if (!value) return 'Not available';

        return new Date(value).toLocaleDateString('en-GH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    function normalizeAdminText(value) {
        return String(value || '').toLowerCase().trim();
    }

    function getStatusBadgeClass(status) {
        const cleanStatus = String(status || '').toLowerCase();

        if (cleanStatus === 'accepted' || cleanStatus === 'available' || cleanStatus === 'active') {
            return 'status-accepted';
        }

        if (cleanStatus === 'rejected' || cleanStatus === 'inactive' || cleanStatus === 'deactivated') {
            return 'status-rejected';
        }

        return 'status-pending';
    }

    function bindNavigation() {
        const navItems = document.querySelectorAll('.nav-item[data-target]');
        const views = document.querySelectorAll('.view-section');

        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();

                const target = item.getAttribute('data-target');

                navItems.forEach(nav => nav.classList.remove('active'));
                views.forEach(view => view.classList.remove('active-view'));

                item.classList.add('active');

                const targetView = document.getElementById(target);
                if (targetView) targetView.classList.add('active-view');

                if (target === 'users') loadUsers();
                if (target === 'properties') loadProperties();
                if (target === 'negotiations') loadNegotiations();
                if (target === 'leases') loadLeases();

                if (target === 'reports') {
                    loadOverviewMetrics().then(() => buildReportSummary());
                }
            });
        });
    }

    function showDashboardSection(sectionId, focusElementId = null) {
        const navItems = document.querySelectorAll('.nav-item[data-target]');
        const views = document.querySelectorAll('.view-section');

        navItems.forEach(nav => {
            nav.classList.toggle('active', nav.getAttribute('data-target') === sectionId);
        });

        views.forEach(view => {
            view.classList.toggle('active-view', view.id === sectionId);
        });

        if (focusElementId) {
            setTimeout(() => {
                const focusEl = document.getElementById(focusElementId);
                if (focusEl) {
                    focusEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 120);
        }
    }

    function bindProfileMenu() {
        profileMenuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();

            if (!profileMenuPanel) return;

            const isOpen = profileMenuPanel.style.display === 'block';
            profileMenuPanel.style.display = isOpen ? 'none' : 'block';
        });

        profileMenuViewProfile?.addEventListener('click', () => {
            if (profileMenuPanel) profileMenuPanel.style.display = 'none';
            showDashboardSection('profile');
        });

        profileMenuAccountSettings?.addEventListener('click', () => {
            if (profileMenuPanel) profileMenuPanel.style.display = 'none';
            showDashboardSection('profile', 'account-settings-card');
        });

        profileMenuLogout?.addEventListener('click', async () => {
            await supabaseClient.auth.signOut();
            window.location.href = 'index.html';
        });

        document.addEventListener('click', (e) => {
            if (!profileMenuPanel || !profileMenuBtn) return;

            const clickedInsidePanel = profileMenuPanel.contains(e.target);
            const clickedAvatar = profileMenuBtn.contains(e.target);

            if (!clickedInsidePanel && !clickedAvatar) {
                profileMenuPanel.style.display = 'none';
            }
        });
    }

    function bindAdminFilters() {
        adminUserSearch?.addEventListener('input', () => renderAdminUsers(cachedUsers));
        adminRoleFilter?.addEventListener('change', () => renderAdminUsers(cachedUsers));
        adminStatusFilter?.addEventListener('change', () => renderAdminUsers(cachedUsers));

        adminPropertySearch?.addEventListener('input', () => renderAdminProperties(cachedProperties));
        adminPropertyStatusFilter?.addEventListener('change', () => renderAdminProperties(cachedProperties));
    }

    async function initAdminDashboard() {
        try {
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

            if (authError || !user) {
                window.location.href = 'index.html';
                return;
            }

            currentUser = user;

            const { data: profile, error: profileError } = await supabaseClient
                .from('users')
                .select('*')
                .eq('id', currentUser.id)
                .maybeSingle();

            if (profileError) throw profileError;

            if (!profile || profile.role !== 'Admin') {
                await supabaseClient.auth.signOut();
                alert('Access denied. Admin account required.');
                window.location.href = 'index.html';
                return;
            }

            if (profile.is_active === false) {
                await supabaseClient.auth.signOut();
                alert('This Admin account has been deactivated.');
                window.location.href = 'index.html';
                return;
            }

            currentProfile = profile;

            loadAdminProfileUI();
            await loadAllDashboardData();
        } catch (err) {
            console.error('Admin initialization error:', err);
            alert('Unable to load Admin Dashboard: ' + err.message);
            window.location.href = 'index.html';
        }
    }

    function loadAdminProfileUI() {
        const fullName = currentProfile?.full_name || 'Admin Account';
        const phone = currentProfile?.phone || currentProfile?.phone_number || '';
        const phoneAlt = currentProfile?.phone_alt || '';

        const encodedName = encodeURIComponent(fullName);
        const fallbackAvatarUrl = `https://ui-avatars.com/api/?name=${encodedName}&background=0D8ABC&color=fff&size=80`;
        const avatarUrl = currentProfile?.profile_photo_url || fallbackAvatarUrl;

        const topbarAvatar = document.getElementById('topbar-avatar');
        const profileAvatar = document.getElementById('profile-avatar-display');
        const displayName = document.getElementById('profile-display-name');
        const welcomeMessage = document.getElementById('welcome-message');

        const nameInput = document.getElementById('profile-name');
        const phoneInput = document.getElementById('profile-phone');
        const phoneAltInput = document.getElementById('profile-phone-alt');

        if (topbarAvatar) topbarAvatar.src = avatarUrl;
        if (profileAvatar) profileAvatar.src = avatarUrl;
        if (displayName) displayName.innerText = fullName;
        if (welcomeMessage) welcomeMessage.innerText = `Welcome, ${fullName}`;

        if (profileMenuName) profileMenuName.innerText = fullName;
        if (profileMenuRole) profileMenuRole.innerText = 'Administrator';

        if (nameInput) nameInput.value = currentProfile?.full_name || '';
        if (phoneInput) phoneInput.value = phone;
        if (phoneAltInput) phoneAltInput.value = phoneAlt;
    }

    async function loadAllDashboardData() {
        await loadOverviewMetrics();
        await loadUsers();
        await loadProperties();
        await loadNegotiations();
        await loadLeases();
        await buildReportSummary();
    }

    async function loadOverviewMetrics() {
        try {
            const { data: users, error: usersError } = await supabaseClient
                .from('users')
                .select('id, role, is_active');

            if (usersError) throw usersError;

            const { data: properties, error: propsError } = await supabaseClient
                .from('properties')
                .select('id, status');

            if (propsError) throw propsError;

            const { data: negotiations, error: negError } = await supabaseClient
                .from('negotiations')
                .select('id, status');

            if (negError) throw negError;

            const userRows = users || [];
            const propertyRows = properties || [];
            const negotiationRows = negotiations || [];

            setText('stat-total-users', userRows.length);
            setText('stat-tenants', userRows.filter(u => u.role === 'Tenant').length);
            setText('stat-landlords', userRows.filter(u => u.role === 'Landlord').length);
            setText('stat-total-properties', propertyRows.length);
            setText('stat-available-properties', propertyRows.filter(p => p.status === 'Available').length);
            setText('stat-occupied-properties', propertyRows.filter(p => p.status === 'Occupied').length);
            setText('stat-pending-negotiations', negotiationRows.filter(n => n.status === 'Pending').length);
            setText('stat-active-leases', negotiationRows.filter(n => n.status === 'Accepted').length);
        } catch (err) {
            console.error('Admin metric loading error:', err.message);
        }
    }

    async function loadUsers() {
        if (!usersList) return;

        usersList.innerHTML = '<p style="padding:20px; text-align:center; color:#64748b;">Loading users...</p>';

        try {
            const { data: users, error } = await supabaseClient
                .from('users')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            cachedUsers = users || [];

            if (cachedUsers.length === 0) {
                usersList.innerHTML = `
                    <div class="empty-state">
                        <i class="ph ph-users-three"></i>
                        <h3>No Users Found</h3>
                        <p>No user profiles are currently available.</p>
                    </div>
                `;
                return;
            }

            renderAdminUsers(cachedUsers);
        } catch (err) {
            usersList.innerHTML = `
                <p style="padding:20px; text-align:center; color:#ef4444;">
                    Failed to load users: ${err.message}
                </p>
            `;
        }
    }

    function renderAdminUsers(users) {
        if (!usersList) return;

        const searchTerm = normalizeAdminText(adminUserSearch?.value);
        const roleFilter = adminRoleFilter?.value || 'all';
        const statusFilter = adminStatusFilter?.value || 'all';

        let filteredUsers = users || [];

        if (searchTerm) {
            filteredUsers = filteredUsers.filter(user => {
                const searchable = normalizeAdminText([
                    user.full_name,
                    user.email,
                    user.role,
                    user.phone,
                    user.phone_number,
                    user.phone_alt
                ].join(' '));

                return searchable.includes(searchTerm);
            });
        }

        if (roleFilter !== 'all') {
            filteredUsers = filteredUsers.filter(user => user.role === roleFilter);
        }

        if (statusFilter === 'active') {
            filteredUsers = filteredUsers.filter(user => user.is_active !== false);
        }

        if (statusFilter === 'inactive') {
            filteredUsers = filteredUsers.filter(user => user.is_active === false);
        }

        if (filteredUsers.length === 0) {
            usersList.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-magnifying-glass"></i>
                    <h3>No Matching Users</h3>
                    <p>Try changing your search keyword or filters.</p>
                </div>
            `;
            return;
        }

        usersList.innerHTML = filteredUsers.map(user => {
            const statusText = user.is_active === false ? 'Deactivated' : 'Active';
            const statusClass = user.is_active === false ? 'status-rejected' : 'status-accepted';
            const role = user.role || 'Unknown';

            return `
                <div class="list-card" style="align-items:center; gap:14px; flex-wrap:wrap;">
                    <div class="list-info" style="flex:1; min-width:260px;">
                        <h4 style="font-weight:600;">
                            ${user.full_name || 'Unnamed User'}
                        </h4>

                        <p class="text-muted" style="font-size:0.88rem;">
                            Email: <strong>${user.email || 'No email stored'}</strong>
                        </p>

                        <p class="text-muted" style="font-size:0.88rem;">
                            Role: <strong>${role}</strong>
                            ${user.phone || user.phone_number ? ` • Phone: ${user.phone || user.phone_number}` : ''}
                            ${user.phone_alt ? ` • Alt: ${user.phone_alt}` : ''}
                        </p>

                        <p class="text-muted" style="font-size:0.8rem;">
                            Joined: ${formatDate(user.created_at)}
                        </p>
                    </div>

                    <span class="status-badge ${statusClass}">
                        ${statusText}
                    </span>

                    <select
                        class="admin-role-select"
                        data-id="${user.id}"
                        ${user.id === currentUser.id ? 'disabled' : ''}
                        style="padding:8px; border:1px solid #cbd5e1; border-radius:8px;"
                    >
                        <option value="Tenant" ${role === 'Tenant' ? 'selected' : ''}>Tenant</option>
                        <option value="Landlord" ${role === 'Landlord' ? 'selected' : ''}>Landlord</option>
                        <option value="Admin" ${role === 'Admin' ? 'selected' : ''}>Admin</option>
                    </select>

                    <button
                        class="btn-outline admin-toggle-user-btn"
                        data-id="${user.id}"
                        data-active="${user.is_active === false ? 'false' : 'true'}"
                        ${user.id === currentUser.id ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}
                    >
                        ${user.is_active === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                </div>
            `;
        }).join('');
    }

    async function loadProperties() {
        if (!propertiesList) return;

        propertiesList.innerHTML = '<p style="padding:20px; text-align:center; color:#64748b;">Loading properties...</p>';

        try {
            const { data: properties, error } = await supabaseClient
                .from('properties')
                .select(`
                    *,
                    landlord:users!landlord_id (
                        full_name,
                        phone,
                        phone_number
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            cachedProperties = properties || [];

            if (cachedProperties.length === 0) {
                propertiesList.innerHTML = `
                    <div class="empty-state">
                        <i class="ph ph-buildings"></i>
                        <h3>No Properties Found</h3>
                        <p>No rental properties have been listed yet.</p>
                    </div>
                `;
                return;
            }

            renderAdminProperties(cachedProperties);
        } catch (err) {
            propertiesList.innerHTML = `
                <p style="padding:20px; text-align:center; color:#ef4444;">
                    Failed to load properties: ${err.message}
                </p>
            `;
        }
    }

    function renderAdminProperties(properties) {
        if (!propertiesList) return;

        const searchTerm = normalizeAdminText(adminPropertySearch?.value);
        const statusFilter = adminPropertyStatusFilter?.value || 'all';

        let filteredProperties = properties || [];

        if (searchTerm) {
            filteredProperties = filteredProperties.filter(property => {
                const searchable = normalizeAdminText([
                    property.title,
                    property.location,
                    property.type,
                    property.status,
                    property.landlord?.full_name,
                    property.price_ghs
                ].join(' '));

                return searchable.includes(searchTerm);
            });
        }

        if (statusFilter !== 'all') {
            filteredProperties = filteredProperties.filter(property => property.status === statusFilter);
        }

        if (filteredProperties.length === 0) {
            propertiesList.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-magnifying-glass"></i>
                    <h3>No Matching Properties</h3>
                    <p>Try changing your search keyword or status filter.</p>
                </div>
            `;
            return;
        }

        propertiesList.innerHTML = filteredProperties.map(property => {
            const status = property.status || 'Unknown';
            const statusClass = getStatusBadgeClass(status);
            const landlordName = property.landlord?.full_name || 'Unknown Landlord';

            return `
                <div class="list-card" style="align-items:center; gap:14px; flex-wrap:wrap;">
                    <div class="list-info" style="flex:1; min-width:280px;">
                        <h4 style="font-weight:600;">
                            ${property.title || 'Untitled Property'}
                        </h4>

                        <p class="text-muted" style="font-size:0.9rem;">
                            <i class="ph ph-map-pin"></i> ${property.location || 'No location'}
                            • Landlord: ${landlordName}
                        </p>

                        <p class="text-muted" style="font-size:0.88rem;">
                            Type: ${property.type || 'N/A'}
                            • Rent: GH₵ ${formatMoney(property.price_ghs)}
                            • Created: ${formatDate(property.created_at)}
                        </p>
                    </div>

                    <span class="status-badge ${statusClass}">
                        ${status}
                    </span>

                    <button
                        class="btn-outline admin-property-status-btn"
                        data-id="${property.id}"
                        data-status="Available"
                        ${status === 'Available' ? 'disabled style="opacity:0.6;"' : ''}
                    >
                        Available
                    </button>

                    <button
                        class="btn-outline admin-property-status-btn"
                        data-id="${property.id}"
                        data-status="Inactive"
                        ${status === 'Inactive' ? 'disabled style="opacity:0.6;"' : ''}
                    >
                        Inactive
                    </button>
                </div>
            `;
        }).join('');
    }

    async function loadNegotiations() {
        if (!negotiationsList) return;

        negotiationsList.innerHTML = '<p style="padding:20px; text-align:center; color:#64748b;">Loading negotiations...</p>';

        try {
            const { data: negotiations, error } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    offer_amount,
                    status,
                    created_at,
                    properties (
                        title,
                        location
                    ),
                    tenant:users!tenant_id (
                        full_name
                    ),
                    landlord:users!landlord_id (
                        full_name
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!negotiations || negotiations.length === 0) {
                negotiationsList.innerHTML = `
                    <div class="empty-state">
                        <i class="ph ph-handshake"></i>
                        <h3>No Negotiations Found</h3>
                        <p>Tenant offers will appear here when submitted.</p>
                    </div>
                `;
                return;
            }

            negotiationsList.innerHTML = negotiations.map(negotiation => {
                const status = negotiation.status || 'Pending';
                const statusClass = getStatusBadgeClass(status);

                return `
                    <div class="list-card" style="align-items:center; gap:14px; flex-wrap:wrap;">
                        <div class="list-info" style="flex:1; min-width:280px;">
                            <h4 style="font-weight:600;">
                                ${negotiation.properties?.title || 'Property'}
                            </h4>

                            <p class="text-muted" style="font-size:0.9rem;">
                                Tenant: ${negotiation.tenant?.full_name || 'Unknown'}
                                • Landlord: ${negotiation.landlord?.full_name || 'Unknown'}
                            </p>

                            <p class="text-muted" style="font-size:0.88rem;">
                                Offer: GH₵ ${formatMoney(negotiation.offer_amount)}
                                • Date: ${formatDate(negotiation.created_at)}
                            </p>
                        </div>

                        <span class="status-badge ${statusClass}">
                            ${status}
                        </span>
                    </div>
                `;
            }).join('');
        } catch (err) {
            negotiationsList.innerHTML = `
                <p style="padding:20px; text-align:center; color:#ef4444;">
                    Failed to load negotiations: ${err.message}
                </p>
            `;
        }
    }

    async function loadLeases() {
        if (!leasesList) return;

        leasesList.innerHTML = '<p style="padding:20px; text-align:center; color:#64748b;">Loading active leases...</p>';

        try {
            const { data: leases, error } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    offer_amount,
                    status,
                    created_at,
                    updated_at,
                    properties (
                        title,
                        location
                    ),
                    tenant:users!tenant_id (
                        full_name,
                        phone,
                        phone_number
                    ),
                    landlord:users!landlord_id (
                        full_name,
                        phone,
                        phone_number
                    )
                `)
                .eq('status', 'Accepted')
                .order('updated_at', { ascending: false });

            if (error) throw error;

            if (!leases || leases.length === 0) {
                leasesList.innerHTML = `
                    <div class="empty-state">
                        <i class="ph ph-file-dashed"></i>
                        <h3>No Active Leases</h3>
                        <p>Accepted offers will appear here as active leases.</p>
                    </div>
                `;
                return;
            }

            leasesList.innerHTML = leases.map(lease => {
                return `
                    <div class="list-card" style="align-items:center; gap:14px; flex-wrap:wrap; border-left:4px solid #16a34a;">
                        <div class="list-info" style="flex:1; min-width:280px;">
                            <h4 style="font-weight:600;">
                                ${lease.properties?.title || 'Property'}
                            </h4>

                            <p class="text-muted" style="font-size:0.9rem;">
                                Location: ${lease.properties?.location || 'N/A'}
                            </p>

                            <p class="text-muted" style="font-size:0.88rem;">
                                Tenant: ${lease.tenant?.full_name || 'Unknown'}
                                • Landlord: ${lease.landlord?.full_name || 'Unknown'}
                            </p>

                            <p class="text-muted" style="font-size:0.88rem;">
                                Agreed Rent: GH₵ ${formatMoney(lease.offer_amount)}
                                • Accepted: ${formatDate(lease.updated_at || lease.created_at)}
                            </p>
                        </div>

                        <span class="status-badge status-accepted">
                            Active Lease
                        </span>
                    </div>
                `;
            }).join('');
        } catch (err) {
            leasesList.innerHTML = `
                <p style="padding:20px; text-align:center; color:#ef4444;">
                    Failed to load active leases: ${err.message}
                </p>
            `;
        }
    }

    async function buildReportSummary() {
        if (!reportSummary) return;

        try {
            const totalUsers = document.getElementById('stat-total-users')?.innerText || '0';
            const tenants = document.getElementById('stat-tenants')?.innerText || '0';
            const landlords = document.getElementById('stat-landlords')?.innerText || '0';
            const properties = document.getElementById('stat-total-properties')?.innerText || '0';
            const available = document.getElementById('stat-available-properties')?.innerText || '0';
            const occupied = document.getElementById('stat-occupied-properties')?.innerText || '0';
            const pending = document.getElementById('stat-pending-negotiations')?.innerText || '0';
            const leases = document.getElementById('stat-active-leases')?.innerText || '0';

            const reportDate = document.getElementById('admin-report-date');
            const observation = document.getElementById('admin-report-observation');

            if (reportDate) {
                reportDate.innerText = `Generated on: ${new Date().toLocaleString('en-GH')}`;
            }

            reportSummary.innerHTML = `
                <div class="report-stat-item">
                    <span>Total Users</span>
                    <strong>${totalUsers}</strong>
                </div>

                <div class="report-stat-item">
                    <span>Tenants</span>
                    <strong>${tenants}</strong>
                </div>

                <div class="report-stat-item">
                    <span>Landlords</span>
                    <strong>${landlords}</strong>
                </div>

                <div class="report-stat-item">
                    <span>Total Properties</span>
                    <strong>${properties}</strong>
                </div>

                <div class="report-stat-item">
                    <span>Available Properties</span>
                    <strong>${available}</strong>
                </div>

                <div class="report-stat-item">
                    <span>Occupied Properties</span>
                    <strong>${occupied}</strong>
                </div>

                <div class="report-stat-item">
                    <span>Pending Offers</span>
                    <strong>${pending}</strong>
                </div>

                <div class="report-stat-item">
                    <span>Active Leases</span>
                    <strong>${leases}</strong>
                </div>
            `;

            if (observation) {
                const userCount = Number(totalUsers) || 0;
                const propertyCount = Number(properties) || 0;
                const leaseCount = Number(leases) || 0;
                const pendingCount = Number(pending) || 0;

                let observationText = '';

                if (userCount === 0 && propertyCount === 0) {
                    observationText =
                        'The platform currently has no recorded users or property listings. Once users begin registering and landlords list properties, system activity will appear in this report.';
                } else {
                    observationText =
                        `The platform currently records ${userCount} user account(s), ${propertyCount} property listing(s), ${pendingCount} pending negotiation(s), and ${leaseCount} active lease record(s). ` +
                        'This indicates that the Admin Dashboard is successfully monitoring major system activities including user registration, property listing, negotiations, and accepted rental agreements.';
                }

                observation.innerText = observationText;
            }
        } catch (err) {
            reportSummary.innerHTML = `
                <p style="color:#ef4444;">Unable to build report summary: ${err.message}</p>
            `;
        }
    }

    function bindProfileForm() {
        const profileForm = document.getElementById('admin-profile-form');

        profileForm?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const saveBtn = document.getElementById('save-profile-btn');
            const originalText = saveBtn ? saveBtn.innerText : 'Save Profile';

            const name = document.getElementById('profile-name')?.value.trim();
            const phone = document.getElementById('profile-phone')?.value.trim();
            const phoneAlt = document.getElementById('profile-phone-alt')?.value.trim();

            if (saveBtn) {
                saveBtn.innerText = 'Saving...';
                saveBtn.disabled = true;
            }

            try {
                const { error } = await supabaseClient
                    .from('users')
                    .update({
                        full_name: name,
                        phone: phone,
                        phone_alt: phoneAlt
                    })
                    .eq('id', currentUser.id);

                if (error) throw error;

                currentProfile = {
                    ...currentProfile,
                    full_name: name,
                    phone,
                    phone_alt: phoneAlt
                };

                loadAdminProfileUI();

                alert('Admin profile updated successfully.');
            } catch (err) {
                alert('Unable to update profile: ' + err.message);
            } finally {
                if (saveBtn) {
                    saveBtn.innerText = originalText;
                    saveBtn.disabled = false;
                }
            }
        });
    }

    function bindPrintReport() {
    const printBtn = document.getElementById('print-admin-report-btn');

    printBtn?.addEventListener('click', async () => {
        await loadOverviewMetrics();
        await buildReportSummary();

        const reportCard = document.getElementById('admin-report-card');

        if (!reportCard) {
            alert('Report content not found.');
            return;
        }

        const printWindow = window.open('', '_blank', 'width=900,height=700');

        if (!printWindow) {
            alert('Popup blocked. Please allow popups for this site and try again.');
            return;
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>RentHaven Ghana Admin Report</title>

                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #ffffff;
                        color: #0f172a;
                        margin: 0;
                        padding: 30px;
                    }

                    .admin-report-document {
                        max-width: 900px;
                        margin: 0 auto;
                        background: #ffffff;
                        color: #0f172a;
                    }

                    .report-header {
                        text-align: center;
                        border-bottom: 2px solid #000000;
                        padding-bottom: 18px;
                        margin-bottom: 24px;
                    }

                    .report-header h2 {
                        margin: 0;
                        font-size: 28px;
                        color: #000000;
                        font-weight: 800;
                    }

                    .report-header h3 {
                        margin: 6px 0;
                        font-size: 18px;
                        color: #000000;
                        font-weight: 700;
                    }

                    .report-header p {
                        margin: 6px 0 0;
                        color: #333333;
                        font-size: 14px;
                    }

                    .report-section {
                        margin-bottom: 24px;
                    }

                    .report-section h3 {
                        font-size: 16px;
                        color: #000000;
                        border-left: 4px solid #000000;
                        padding-left: 10px;
                        margin-bottom: 10px;
                    }

                    .report-section p {
                        color: #333333;
                        line-height: 1.7;
                        font-size: 14px;
                    }

                    .report-stat-grid {
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 12px;
                        margin-top: 14px;
                    }

                    .report-stat-item {
                        border: 1px solid #999999;
                        border-radius: 8px;
                        padding: 14px;
                        background: #ffffff;
                        break-inside: avoid;
                    }

                    .report-stat-item span {
                        display: block;
                        color: #444444;
                        font-size: 13px;
                        margin-bottom: 6px;
                    }

                    .report-stat-item strong {
                        display: block;
                        font-size: 24px;
                        color: #000000;
                    }

                    .report-footer {
                        border-top: 1px solid #999999;
                        padding-top: 16px;
                        margin-top: 24px;
                        text-align: center;
                        color: #333333;
                        font-size: 12px;
                    }

                    .report-footer p {
                        margin: 4px 0;
                    }

                    @media print {
                        body {
                            padding: 20px;
                        }
                    }
                </style>
            </head>

            <body>
                ${reportCard.outerHTML}
            </body>
            </html>
        `);

        printWindow.document.close();

        printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
        };
    });
}

    function bindRefresh() {
        const refreshBtn = document.getElementById('admin-refresh-btn');

        refreshBtn?.addEventListener('click', async () => {
            const originalText = refreshBtn.innerHTML;

            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Refreshing...';

            try {
                await loadAllDashboardData();
            } catch (err) {
                alert('Refresh failed: ' + err.message);
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = originalText;
            }
        });
    }

    document.addEventListener('change', async (e) => {
        const roleSelect = e.target.closest('.admin-role-select');
        if (!roleSelect) return;

        const userId = roleSelect.getAttribute('data-id');
        const newRole = roleSelect.value;

        if (!userId || !newRole) return;

        const confirmed = confirm(`Change this user's role to ${newRole}?`);
        if (!confirmed) {
            await loadUsers();
            return;
        }

        try {
            const { error } = await supabaseClient
                .from('users')
                .update({ role: newRole })
                .eq('id', userId);

            if (error) throw error;

            await loadOverviewMetrics();
            await loadUsers();

            alert('User role updated successfully.');
        } catch (err) {
            alert('Unable to update role: ' + err.message);
            await loadUsers();
        }
    });

    document.addEventListener('click', async (e) => {
        const toggleUserBtn = e.target.closest('.admin-toggle-user-btn');

        if (toggleUserBtn) {
            const userId = toggleUserBtn.getAttribute('data-id');
            const currentlyActive = toggleUserBtn.getAttribute('data-active') === 'true';
            const nextActive = !currentlyActive;

            const confirmed = confirm(nextActive
                ? 'Reactivate this user account?'
                : 'Deactivate this user account?'
            );

            if (!confirmed) return;

            const originalText = toggleUserBtn.innerText;
            toggleUserBtn.disabled = true;
            toggleUserBtn.innerText = 'Updating...';

            try {
                const { error } = await supabaseClient
                    .from('users')
                    .update({ is_active: nextActive })
                    .eq('id', userId);

                if (error) throw error;

                await loadOverviewMetrics();
                await loadUsers();

                alert(nextActive ? 'User reactivated successfully.' : 'User deactivated successfully.');
            } catch (err) {
                alert('Unable to update user status: ' + err.message);
                toggleUserBtn.disabled = false;
                toggleUserBtn.innerText = originalText;
            }

            return;
        }

        const propertyStatusBtn = e.target.closest('.admin-property-status-btn');

        if (propertyStatusBtn) {
            const propertyId = propertyStatusBtn.getAttribute('data-id');
            const nextStatus = propertyStatusBtn.getAttribute('data-status');

            if (!propertyId || !nextStatus) return;

            const confirmed = confirm(`Mark this property as ${nextStatus}?`);
            if (!confirmed) return;

            const originalText = propertyStatusBtn.innerText;
            propertyStatusBtn.disabled = true;
            propertyStatusBtn.innerText = 'Updating...';

            try {
                const { error } = await supabaseClient
                    .from('properties')
                    .update({ status: nextStatus })
                    .eq('id', propertyId);

                if (error) throw error;

                await loadOverviewMetrics();
                await loadProperties();

                alert(`Property marked as ${nextStatus}.`);
            } catch (err) {
                alert('Unable to update property: ' + err.message);
                propertyStatusBtn.disabled = false;
                propertyStatusBtn.innerText = originalText;
            }
        }
    });
})();