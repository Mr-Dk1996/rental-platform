(() => {
    // ==========================================
    // 1. CORE STATE AND DOM REFERENCES
    // ==========================================
    let currentUser = null;
    let activeNegotiationId = null;

    const propertiesGrid = document.getElementById('landlord-properties-grid');
    const incomingOffersList = document.getElementById('incoming-offers-list');
    const activeLeasesList = document.getElementById('active-leases-list');

    const chatModal = document.getElementById('chat-modal');
    const messagesContainer = document.getElementById('chat-messages-container');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-message-input');

    const addPropertyModal = document.getElementById('add-property-modal');
    const openPropertyModalBtn = document.getElementById('open-add-property-modal');
    const closePropertyModalBtn = document.getElementById('close-property-modal-btn');
    const addPropertyForm = document.getElementById('add-property-form');

    const propertyModalTitle = document.getElementById('property-modal-title');
    const propertySubmitBtn = document.getElementById('property-submit-btn');
    const landlordProfileForm = document.getElementById('landlord-profile-form');

    const propEditId = document.getElementById('prop-edit-id');
    const propTitle = document.getElementById('prop-title');
    const propLocation = document.getElementById('prop-location');
    const propDescription = document.getElementById('prop-description');
    const propPrice = document.getElementById('prop-price');
    const propType = document.getElementById('prop-type');
    const propBeds = document.getElementById('prop-beds');
    const propBaths = document.getElementById('prop-baths');
    const propCondition = document.getElementById('prop-condition');
    const propFurnishing = document.getElementById('prop-furnishing');
    const propMeterType = document.getElementById('prop-meter-type');
    const propIndoorBathroom = document.getElementById('prop-indoor-bathroom');
    const propToiletWc = document.getElementById('prop-toilet-wc');
    const propIndoorKitchen = document.getElementById('prop-indoor-kitchen');
    const propImageFile = document.getElementById('prop-image-file');
    const propImageHelp = document.getElementById('prop-image-help');

    const notificationBtn = document.getElementById('landlord-notification-btn');
    const notificationPanel = document.getElementById('landlord-notification-panel');
    const notificationList = document.getElementById('landlord-notification-list');
    const notificationCount = document.getElementById('landlord-notification-count');
    const markNotificationsReadBtn = document.getElementById('landlord-mark-notifications-read');

    const profileMenuBtn = document.getElementById('profile-menu-btn');
    const profileMenuPanel = document.getElementById('profile-menu-panel');
    const profileMenuName = document.getElementById('profile-menu-name');
    const profileMenuRole = document.getElementById('profile-menu-role');
    const profileMenuViewProfile = document.getElementById('profile-menu-view-profile');
    const profileMenuAccountSettings = document.getElementById('profile-menu-account-settings');
    const profileMenuLogout = document.getElementById('profile-menu-logout');
    const updateEmailBtn = document.getElementById('update-email-btn');

    document.addEventListener('DOMContentLoaded', () => {
        bindNavigation();
        bindLogout();
        bindProfileMenu();
        bindEmailUpdate();
        bindPropertyModal();
        bindNotificationUI();
        initLandlordPortal();
    });

    // ==========================================
    // 2. NAVIGATION AND AUTH
    // ==========================================
    function bindNavigation() {
        const navItems = document.querySelectorAll('.nav-item[data-target]');
        const views = document.querySelectorAll('.view-section');

        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();

                navItems.forEach(nav => nav.classList.remove('active'));
                views.forEach(view => view.classList.remove('active-view'));

                item.classList.add('active');

                const targetView = document.getElementById(item.getAttribute('data-target'));

                if (targetView) {
                    targetView.classList.add('active-view');
                }

                if (item.getAttribute('data-target') === 'listings') {
                    loadLandlordProperties();
                }

                if (item.getAttribute('data-target') === 'offers' || item.getAttribute('data-target') === 'leases') {
                    loadIncomingOffers();
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

    async function performLogout() {
        try {
            await supabaseClient.auth.signOut();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Logout error:', error.message);
            alert('Logout failed. Please try again.');
        }
    }

    function bindLogout() {
        const logoutBtn = document.getElementById('logout-btn');

        if (logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await performLogout();
            });
        }

        if (profileMenuLogout) {
            profileMenuLogout.addEventListener('click', async (e) => {
                e.preventDefault();
                await performLogout();
            });
        }
    }

    function bindProfileMenu() {
        profileMenuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();

            if (!profileMenuPanel) return;

            const isOpen = profileMenuPanel.style.display === 'block';
            profileMenuPanel.style.display = isOpen ? 'none' : 'block';

            if (notificationPanel) {
                notificationPanel.style.display = 'none';
            }
        });

        profileMenuViewProfile?.addEventListener('click', () => {
            if (profileMenuPanel) profileMenuPanel.style.display = 'none';
            showDashboardSection('profile');
        });

        profileMenuAccountSettings?.addEventListener('click', () => {
            if (profileMenuPanel) profileMenuPanel.style.display = 'none';
            showDashboardSection('profile', 'account-settings-card');
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

    async function initLandlordPortal() {
        try {
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

            if (authError || !user) {
                window.location.href = 'index.html';
                return;
            }

            currentUser = user;

            await loadUserProfile();
            await loadOverviewMetrics();
            await loadLandlordProperties();
            await loadIncomingOffers();
            await loadLandlordNotifications();
        } catch (err) {
            console.error('Dashboard initialization failed:', err.message);
        }
    }

    // ==========================================
    // 3. PROFILE AND METRICS
    // ==========================================
    async function loadUserProfile() {
        try {
            const { data: profile, error } = await supabaseClient
                .from('users')
                .select('*')
                .eq('id', currentUser.id)
                .single();

            if (error) throw error;

            if (!profile) return;

            const nameInput = document.getElementById('profile-name');
            const phoneInput = document.getElementById('profile-phone');
            const phoneAltInput = document.getElementById('profile-phone-alt');
            const currentEmailInput = document.getElementById('profile-current-email');
            const newEmailInput = document.getElementById('profile-new-email');

            const displayName = document.getElementById('profile-display-name');
            const welcomeMsg = document.getElementById('welcome-message');
            const avatarDisplay = document.getElementById('profile-avatar-display');
            const topbarAvatar = document.getElementById('topbar-avatar');

            const fullName = profile.full_name || 'Landlord Account';
            const primaryPhone = profile.phone || profile.phone_number || '';
            const alternativePhone = profile.phone_alt || '';
            const email = currentUser?.email || '';

            if (nameInput) nameInput.value = profile.full_name || '';
            if (phoneInput) phoneInput.value = primaryPhone;
            if (phoneAltInput) phoneAltInput.value = alternativePhone;
            if (currentEmailInput) currentEmailInput.value = email;
            if (newEmailInput) newEmailInput.value = '';

            if (displayName) displayName.innerText = fullName;
            if (welcomeMsg) welcomeMsg.innerText = `Welcome Back, ${profile.full_name || 'Landlord'}`;

            if (profileMenuName) profileMenuName.innerText = fullName;
            if (profileMenuRole) profileMenuRole.innerText = 'Landlord Account';

            const encodedName = encodeURIComponent(fullName);
            const fallbackAvatarUrl = `https://ui-avatars.com/api/?name=${encodedName}&background=0D8ABC&color=fff&size=80`;
            const avatarUrl = profile.profile_photo_url || fallbackAvatarUrl;

            if (avatarDisplay) avatarDisplay.src = avatarUrl;
            if (topbarAvatar) topbarAvatar.src = avatarUrl;
        } catch (err) {
            console.error('Profile loading error:', err.message);
        }
    }

    async function loadOverviewMetrics() {
        try {
            const { count: countProp } = await supabaseClient
                .from('properties')
                .select('*', { count: 'exact', head: true })
                .eq('landlord_id', currentUser.id);

            const { count: countPending } = await supabaseClient
                .from('negotiations')
                .select('*', { count: 'exact', head: true })
                .eq('landlord_id', currentUser.id)
                .eq('status', 'Pending');

            const { count: countActive } = await supabaseClient
                .from('negotiations')
                .select('*', { count: 'exact', head: true })
                .eq('landlord_id', currentUser.id)
                .eq('status', 'Accepted');

            const totalPropEl = document.getElementById('stat-total-properties');
            const pendOfferEl = document.getElementById('stat-pending-offers');
            const activeLeaseEl = document.getElementById('stat-active-leases');

            if (totalPropEl) totalPropEl.innerText = countProp || 0;
            if (pendOfferEl) pendOfferEl.innerText = countPending || 0;
            if (activeLeaseEl) activeLeaseEl.innerText = countActive || 0;
        } catch (err) {
            console.error('Metrics loading error:', err.message);
        }
    }

    // ==========================================
    // 4. NOTIFICATIONS
    // ==========================================
    function bindNotificationUI() {
        notificationBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();

            if (!notificationPanel) return;

            const isOpen = notificationPanel.style.display === 'block';
            notificationPanel.style.display = isOpen ? 'none' : 'block';

            if (profileMenuPanel) {
                profileMenuPanel.style.display = 'none';
            }

            if (!isOpen) {
                await loadLandlordNotifications();
            }
        });

        document.addEventListener('click', (e) => {
            if (!notificationPanel || !notificationBtn) return;

            const clickedInsidePanel = notificationPanel.contains(e.target);
            const clickedBell = notificationBtn.contains(e.target);

            if (!clickedInsidePanel && !clickedBell) {
                notificationPanel.style.display = 'none';
            }
        });

        markNotificationsReadBtn?.addEventListener('click', async (e) => {
            e.preventDefault();

            if (!currentUser) return;

            const originalText = markNotificationsReadBtn.innerText;
            markNotificationsReadBtn.disabled = true;
            markNotificationsReadBtn.innerText = 'Updating...';

            try {
                const { error } = await supabaseClient
                    .from('notifications')
                    .update({ is_read: true })
                    .eq('user_id', currentUser.id)
                    .eq('is_read', false);

                if (error) throw error;

                await loadLandlordNotifications();
            } catch (err) {
                alert('Unable to mark notifications as read: ' + err.message);
            } finally {
                markNotificationsReadBtn.disabled = false;
                markNotificationsReadBtn.innerText = originalText;
            }
        });
    }

    function formatNotificationTime(value) {
        if (!value) return '';

        const date = new Date(value);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hr ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return date.toLocaleDateString('en-GH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    async function loadLandlordNotifications() {
        if (!notificationList || !notificationCount || !currentUser) return;

        try {
            const { data: notifications, error } = await supabaseClient
                .from('notifications')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;

            const items = notifications || [];
            const unreadCount = items.filter(item => item.is_read === false).length;

            if (unreadCount > 0) {
                notificationCount.style.display = 'flex';
                notificationCount.innerText = unreadCount > 9 ? '9+' : unreadCount;
            } else {
                notificationCount.style.display = 'none';
                notificationCount.innerText = '0';
            }

            if (items.length === 0) {
                notificationList.innerHTML = `
                    <div style="padding: 24px; text-align: center; color: #64748b;">
                        <i class="ph ph-bell-slash" style="font-size: 2rem; color: #94a3b8;"></i>
                        <h4 style="margin: 8px 0 4px 0;">No Notifications</h4>
                        <p style="margin: 0; font-size: 0.85rem;">New tenant offers and system updates will appear here.</p>
                    </div>
                `;
                return;
            }

            notificationList.innerHTML = items.map(item => {
                const unreadStyle = item.is_read ? '' : 'background: #f8fafc;';
                const dot = item.is_read ? '' : '<span style="width: 8px; height: 8px; border-radius: 50%; background: #0d8abc; display: inline-block; margin-top: 6px;"></span>';

                return `
                    <div style="display: flex; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #f1f5f9; ${unreadStyle}">
                        <div style="width: 18px; display: flex; justify-content: center;">
                            ${dot}
                        </div>

                        <div style="flex: 1;">
                            <h4 style="margin: 0 0 4px 0; font-size: 0.92rem; color: #0f172a;">
                                ${item.title || 'Notification'}
                            </h4>

                            <p style="margin: 0; color: #64748b; font-size: 0.82rem; line-height: 1.4;">
                                ${item.message || ''}
                            </p>

                            <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 0.75rem;">
                                ${formatNotificationTime(item.created_at)}
                            </p>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Notification loading error:', err.message);

            notificationList.innerHTML = `
                <div style="padding: 24px; text-align: center; color: #ef4444;">
                    Unable to load notifications: ${err.message}
                </div>
            `;
        }
    }

    async function createNotification(userId, title, message, type = 'info', relatedId = null) {
        if (!userId) return;

        try {
            const { error } = await supabaseClient
                .from('notifications')
                .insert([{
                    user_id: userId,
                    title,
                    message,
                    type,
                    related_id: relatedId,
                    is_read: false
                }]);

            if (error) throw error;
        } catch (err) {
            console.warn('Notification creation skipped:', err.message);
        }
    }

    // ==========================================
    // 5. PROPERTY MODAL HELPERS
    // ==========================================
    function bindPropertyModal() {
        openPropertyModalBtn?.addEventListener('click', () => {
            openAddPropertyModal();
        });

        closePropertyModalBtn?.addEventListener('click', () => {
            closePropertyModal();
        });

        addPropertyModal?.addEventListener('click', (e) => {
            if (e.target === addPropertyModal) {
                closePropertyModal();
            }
        });
    }

    function resetExtraPropertyFields() {
        if (propDescription) propDescription.value = '';
        if (propCondition) propCondition.value = '';
        if (propFurnishing) propFurnishing.value = '';
        if (propMeterType) propMeterType.value = '';
        if (propIndoorBathroom) propIndoorBathroom.checked = false;
        if (propToiletWc) propToiletWc.checked = false;
        if (propIndoorKitchen) propIndoorKitchen.checked = false;
    }

    function openAddPropertyModal() {
        if (!addPropertyModal || !addPropertyForm) return;

        addPropertyForm.dataset.mode = 'add';

        if (propertyModalTitle) propertyModalTitle.innerText = 'List New Rental Property';
        if (propertySubmitBtn) propertySubmitBtn.innerText = 'Save Property';

        if (propEditId) propEditId.value = '';
        if (propTitle) propTitle.value = '';
        if (propLocation) propLocation.value = '';
        if (propDescription) propDescription.value = '';
        if (propPrice) propPrice.value = '';
        if (propType) propType.value = 'Single Room';
        if (propBeds) propBeds.value = 1;
        if (propBaths) propBaths.value = 1;

        resetExtraPropertyFields();

        if (propImageFile) {
            propImageFile.value = '';
            propImageFile.required = true;
        }

        if (propImageHelp) {
            propImageHelp.innerText = 'PNG, JPG, or JPEG formats supported. You can select more than one image. At least one image is required when adding a new property.';
        }

        addPropertyModal.style.display = 'flex';
    }

    function openEditPropertyModal(property) {
        if (!addPropertyModal || !addPropertyForm || !property) return;

        addPropertyForm.dataset.mode = 'edit';

        if (propertyModalTitle) propertyModalTitle.innerText = 'Edit Rental Property';
        if (propertySubmitBtn) propertySubmitBtn.innerText = 'Update Property';

        if (propEditId) propEditId.value = property.id || '';
        if (propTitle) propTitle.value = property.title || '';
        if (propLocation) propLocation.value = property.location || '';
        if (propDescription) propDescription.value = property.description || '';
        if (propPrice) propPrice.value = property.price_ghs || '';
        if (propType) propType.value = property.type || property.amenities?.type || 'Single Room';
        if (propBeds) propBeds.value = property.bedrooms ?? property.amenities?.beds ?? 1;
        if (propBaths) propBaths.value = property.bathrooms ?? property.amenities?.baths ?? 1;

        if (propCondition) propCondition.value = property.condition || '';
        if (propFurnishing) propFurnishing.value = property.furnishing || '';
        if (propMeterType) propMeterType.value = property.meter_type || '';

        if (propIndoorBathroom) propIndoorBathroom.checked = property.has_indoor_bathroom === true;
        if (propToiletWc) propToiletWc.checked = property.has_toilet_wc === true;
        if (propIndoorKitchen) propIndoorKitchen.checked = property.has_indoor_kitchen === true;

        if (propImageFile) {
            propImageFile.value = '';
            propImageFile.required = false;
        }

        if (propImageHelp) {
            propImageHelp.innerText = 'Optional during edit. If you select new images, they will replace the current property photos.';
        }

        addPropertyModal.style.display = 'flex';
    }

    function closePropertyModal() {
        if (addPropertyModal) {
            addPropertyModal.style.display = 'none';
        }
    }

    async function uploadSinglePropertyImage(file) {
        if (!file) return null;

        const fileExt = file.name.split('.').pop();
        const cleanExt = fileExt ? fileExt.toLowerCase() : 'jpg';
        const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${cleanExt}`;
        const filePath = `${currentUser.id}/${fileName}`;

        const { error: uploadError } = await supabaseClient
            .storage
            .from('property-images')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || 'image/jpeg'
            });

        if (uploadError) throw uploadError;

        const { data: publicData } = supabaseClient
            .storage
            .from('property-images')
            .getPublicUrl(filePath);

        return publicData.publicUrl;
    }

    async function uploadMultiplePropertyImages(propertyId, files, replaceExisting = false) {
        const selectedFiles = Array.from(files || []);

        if (!propertyId || selectedFiles.length === 0) {
            return [];
        }

        if (replaceExisting) {
            const { error: deleteExistingError } = await supabaseClient
                .from('property_images')
                .delete()
                .eq('property_id', propertyId);

            if (deleteExistingError) throw deleteExistingError;
        }

        const uploadedUrls = [];

        for (let index = 0; index < selectedFiles.length; index++) {
            const file = selectedFiles[index];

            if (!file.type || !file.type.startsWith('image/')) {
                throw new Error('Only image files are allowed.');
            }

            const publicUrl = await uploadSinglePropertyImage(file);

            uploadedUrls.push({
                property_id: propertyId,
                storage_path: publicUrl,
                is_primary: index === 0,
                created_at: new Date().toISOString()
            });
        }

        if (uploadedUrls.length > 0) {
            const { error: imageInsertError } = await supabaseClient
                .from('property_images')
                .insert(uploadedUrls);

            if (imageInsertError) throw imageInsertError;
        }

        return uploadedUrls.map(item => item.storage_path);
    }

    async function getExistingPropertyImages(propertyId) {
        if (!propertyId) return [];

        const { data, error } = await supabaseClient
            .from('property_images')
            .select('storage_path, is_primary, created_at')
            .eq('property_id', propertyId)
            .order('is_primary', { ascending: false })
            .order('created_at', { ascending: true });

        if (error) throw error;

        return (data || []).map(item => item.storage_path).filter(Boolean);
    }

    // ==========================================
    // 6. LOAD AND RENDER LANDLORD PROPERTIES
    // ==========================================
    async function loadLandlordProperties() {
        if (!propertiesGrid) return;

        propertiesGrid.innerHTML = `
            <p style="grid-column: 1/-1; text-align:center; color: #64748b;">
                Loading your properties...
            </p>
        `;

        try {
            const { data: props, error } = await supabaseClient
                .from('properties')
                .select('*, property_images(storage_path, is_primary, created_at)')
                .eq('landlord_id', currentUser.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!props || props.length === 0) {
                propertiesGrid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px;">
                        <i class="ph ph-buildings" style="font-size: 3rem; color: #94a3b8;"></i>
                        <h3 style="margin-top: 12px; font-weight: 600;">No Properties Registered</h3>
                        <p style="color: #64748b; font-size: 0.9rem;">Click Add Property to list your first rental space.</p>
                    </div>
                `;
                return;
            }

            propertiesGrid.innerHTML = props.map(p => {
                let img = 'https://via.placeholder.com/400x250?text=Property+Image';

                if (p.property_images && p.property_images.length > 0) {
                    const primaryImage = p.property_images.find(image => image.is_primary === true);
                    img = primaryImage?.storage_path || p.property_images[0].storage_path;
                } else if (Array.isArray(p.images) && p.images.length > 0) {
                    img = p.images[0];
                }

                const amenities = p.amenities || {};
                const propType = p.type || amenities.type || 'Property';

                const formattedPrice = Number(p.price_ghs || 0).toLocaleString('en-GH', {
                    minimumFractionDigits: 0
                });

                const status = p.status || 'Available';

                let badgeClass = 'status-pending';

                if (status === 'Available') badgeClass = 'status-accepted';
                if (status === 'Occupied') badgeClass = 'status-pending';
                if (status === 'Inactive') badgeClass = 'status-rejected';

                const statusActionButton = status === 'Available'
                    ? `
                        <button
                            class="btn-outline property-status-btn"
                            data-id="${p.id}"
                            data-status="Inactive"
                            style="font-size:0.85rem; padding:8px 10px;"
                        >
                            Mark Inactive
                        </button>
                    `
                    : status === 'Inactive'
                        ? `
                            <button
                                class="btn-outline property-status-btn"
                                data-id="${p.id}"
                                data-status="Available"
                                style="font-size:0.85rem; padding:8px 10px; border-color:#16a34a; color:#16a34a;"
                            >
                                Mark Available
                            </button>
                        `
                        : `
                            <button
                                class="btn-outline"
                                disabled
                                style="font-size:0.85rem; padding:8px 10px; opacity:0.6; cursor:not-allowed;"
                            >
                                Occupied
                            </button>
                        `;

                const details = [
                    p.condition,
                    p.furnishing,
                    p.meter_type
                ].filter(Boolean).join(' • ');

                const imageCount = p.property_images?.length || (Array.isArray(p.images) ? p.images.length : 0);

                return `
                    <div class="property-card" data-id="${p.id}">
                        <div class="image-container">
                            <img src="${img}" alt="Property Photo" loading="lazy">
                            ${imageCount > 1 ? `
                                <span style="position:absolute; top:10px; right:10px; background:rgba(15,23,42,0.8); color:#fff; padding:4px 8px; border-radius:999px; font-size:0.75rem;">
                                    ${imageCount} Photos
                                </span>
                            ` : ''}
                        </div>

                        <div class="card-content">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                                <div class="property-type">${propType}</div>
                                <span class="status-badge ${badgeClass}">${status}</span>
                            </div>

                            <h3 style="font-weight:600; margin: 8px 0;">
                                ${p.title || 'Untitled Property'}
                            </h3>

                            <div class="location" style="color: #64748b; font-size: 0.9rem;">
                                <i class="ph ph-map-pin"></i> ${p.location || 'Unspecified'}
                            </div>

                            <div style="display:flex; gap:14px; flex-wrap:wrap; color:#64748b; font-size:0.9rem; margin-top:10px;">
                                <span><i class="ph ph-bed"></i> ${p.bedrooms ?? amenities.beds ?? '-'} Bed</span>
                                <span><i class="ph ph-bathtub"></i> ${p.bathrooms ?? amenities.baths ?? '-'} Bath</span>
                            </div>

                            ${details ? `
                                <p style="font-size:0.82rem; color:#64748b; margin:8px 0 0 0;">
                                    ${details}
                                </p>
                            ` : ''}

                            <div class="price-container" style="margin-top: 10px;">
                                <div class="price" style="font-weight:700; color:#0d8abc;">
                                    GHS ${formattedPrice}
                                </div>
                                <span class="price-period">/ month</span>
                            </div>

                            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:16px;">
                                <button
                                    class="btn-primary property-edit-btn"
                                    data-id="${p.id}"
                                    style="font-size:0.85rem; padding:8px 10px;"
                                >
                                    <i class="ph ph-pencil-simple"></i> Edit
                                </button>

                                ${statusActionButton}

                                <button
                                    class="btn-outline property-delete-btn"
                                    data-id="${p.id}"
                                    data-status="${status}"
                                    style="font-size:0.85rem; padding:8px 10px; border-color:#dc2626; color:#dc2626;"
                                >
                                    <i class="ph ph-trash"></i> Delete
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            propertiesGrid.innerHTML = `
                <p style="color:#ef4444; grid-column:1/-1; text-align:center;">
                    Failed to load properties: ${err.message}
                </p>
            `;
        }
    }

    // ==========================================
    // 7. ADD OR EDIT PROPERTY FORM SUBMIT
    // ==========================================
    addPropertyForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = addPropertyForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn ? submitBtn.innerText : 'Save Property';

        const mode = addPropertyForm.dataset.mode || 'add';
        const editId = propEditId?.value || '';

        const title = propTitle?.value.trim();
        const location = propLocation?.value.trim();
        const description = propDescription?.value.trim() || null;
        const price = parseFloat(propPrice?.value);
        const type = propType?.value;
        const beds = parseInt(propBeds?.value) || 1;
        const baths = parseInt(propBaths?.value) || 1;

        const condition = propCondition?.value || null;
        const furnishing = propFurnishing?.value || null;
        const meterType = propMeterType?.value || null;
        const hasIndoorBathroom = propIndoorBathroom?.checked === true;
        const hasToiletWc = propToiletWc?.checked === true;
        const hasIndoorKitchen = propIndoorKitchen?.checked === true;

        const selectedFiles = propImageFile?.files ? Array.from(propImageFile.files) : [];

        if (!title || !location || !price || !type) {
            alert('Please complete the required property details before saving.');
            return;
        }

        if (mode === 'add' && selectedFiles.length === 0) {
            alert('Please upload at least one property image.');
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.innerText = mode === 'edit' ? 'Updating Property...' : 'Saving Property...';
                submitBtn.disabled = true;
            }

            const propertyData = {
                title,
                location,
                description,
                price_ghs: price,
                bedrooms: beds,
                bathrooms: baths,
                type,
                condition,
                furnishing,
                has_indoor_bathroom: hasIndoorBathroom,
                has_toilet_wc: hasToiletWc,
                has_indoor_kitchen: hasIndoorKitchen,
                meter_type: meterType,
                amenities: {
                    type,
                    beds,
                    baths,
                    condition,
                    furnishing,
                    has_indoor_bathroom: hasIndoorBathroom,
                    has_toilet_wc: hasToiletWc,
                    has_indoor_kitchen: hasIndoorKitchen,
                    meter_type: meterType
                }
            };

            if (mode === 'add') {
                propertyData.landlord_id = currentUser.id;
                propertyData.status = 'Available';

                const { data: insertedProperty, error: insertError } = await supabaseClient
                    .from('properties')
                    .insert([propertyData])
                    .select('id')
                    .single();

                if (insertError) throw insertError;

                if (submitBtn) submitBtn.innerText = 'Uploading Images...';

                const uploadedImageUrls = await uploadMultiplePropertyImages(
                    insertedProperty.id,
                    selectedFiles,
                    false
                );

                if (uploadedImageUrls.length > 0) {
                    const { error: updateImageArrayError } = await supabaseClient
                        .from('properties')
                        .update({ images: uploadedImageUrls })
                        .eq('id', insertedProperty.id)
                        .eq('landlord_id', currentUser.id);

                    if (updateImageArrayError) throw updateImageArrayError;
                }

                alert('Property listing added successfully.');
            } else {
                if (!editId) {
                    alert('Property ID missing. Please refresh and try again.');
                    return;
                }

                if (submitBtn) submitBtn.innerText = 'Updating Property Details...';

                const { error: updateError } = await supabaseClient
                    .from('properties')
                    .update(propertyData)
                    .eq('id', editId)
                    .eq('landlord_id', currentUser.id);

                if (updateError) throw updateError;

                if (selectedFiles.length > 0) {
                    if (submitBtn) submitBtn.innerText = 'Replacing Images...';

                    const uploadedImageUrls = await uploadMultiplePropertyImages(
                        editId,
                        selectedFiles,
                        true
                    );

                    if (uploadedImageUrls.length > 0) {
                        const { error: updateImageArrayError } = await supabaseClient
                            .from('properties')
                            .update({ images: uploadedImageUrls })
                            .eq('id', editId)
                            .eq('landlord_id', currentUser.id);

                        if (updateImageArrayError) throw updateImageArrayError;
                    }
                } else {
                    const existingImages = await getExistingPropertyImages(editId);

                    if (existingImages.length > 0) {
                        await supabaseClient
                            .from('properties')
                            .update({ images: existingImages })
                            .eq('id', editId)
                            .eq('landlord_id', currentUser.id);
                    }
                }

                alert('Property updated successfully.');
            }

            closePropertyModal();
            addPropertyForm.reset();
            resetExtraPropertyFields();

            await loadOverviewMetrics();
            await loadLandlordProperties();
        } catch (err) {
            console.error('Property save error:', err);
            alert('Unable to save property: ' + (err.message || JSON.stringify(err)));
        } finally {
            if (submitBtn) {
                submitBtn.innerText = originalBtnText;
                submitBtn.disabled = false;
            }
        }
    });

    // ==========================================
    // 8. PROPERTY MANAGEMENT ACTIONS
    // ==========================================
    document.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.property-edit-btn');
        const statusBtn = e.target.closest('.property-status-btn');
        const deleteBtn = e.target.closest('.property-delete-btn');

        if (editBtn) {
            const propertyId = editBtn.getAttribute('data-id');

            if (!propertyId) return;

            editBtn.disabled = true;
            const originalText = editBtn.innerHTML;
            editBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Loading...';

            try {
                const { data: property, error } = await supabaseClient
                    .from('properties')
                    .select('*')
                    .eq('id', propertyId)
                    .eq('landlord_id', currentUser.id)
                    .single();

                if (error) throw error;

                openEditPropertyModal(property);
            } catch (err) {
                alert('Unable to load property for editing: ' + err.message);
            } finally {
                editBtn.disabled = false;
                editBtn.innerHTML = originalText;
            }

            return;
        }

        if (statusBtn) {
            const propertyId = statusBtn.getAttribute('data-id');
            const nextStatus = statusBtn.getAttribute('data-status');

            if (!propertyId || !nextStatus) return;

            const message = nextStatus === 'Inactive'
                ? 'Mark this property as Inactive? Tenants will no longer see it in available listings.'
                : 'Mark this property as Available? Tenants will be able to see it again.';

            if (!confirm(message)) return;

            const originalText = statusBtn.innerText;
            statusBtn.disabled = true;
            statusBtn.innerText = 'Updating...';

            try {
                const { error } = await supabaseClient
                    .from('properties')
                    .update({ status: nextStatus })
                    .eq('id', propertyId)
                    .eq('landlord_id', currentUser.id);

                if (error) throw error;

                await loadOverviewMetrics();
                await loadLandlordProperties();

                alert(`Property marked as ${nextStatus}.`);
            } catch (err) {
                alert('Unable to update property status: ' + err.message);
                statusBtn.disabled = false;
                statusBtn.innerText = originalText;
            }

            return;
        }

        if (deleteBtn) {
            const propertyId = deleteBtn.getAttribute('data-id');
            const status = deleteBtn.getAttribute('data-status');

            if (!propertyId) return;

            if (status === 'Occupied') {
                alert('This property is Occupied. You cannot delete a property with an active lease.');
                return;
            }

            const confirmed = confirm('Delete this property permanently? This action cannot be undone.');
            if (!confirmed) return;

            const originalText = deleteBtn.innerHTML;
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Deleting...';

            try {
                const { error } = await supabaseClient
                    .from('properties')
                    .delete()
                    .eq('id', propertyId)
                    .eq('landlord_id', currentUser.id)
                    .neq('status', 'Occupied');

                if (error) throw error;

                await loadOverviewMetrics();
                await loadLandlordProperties();

                alert('Property deleted successfully.');
            } catch (err) {
                alert('Unable to delete property: ' + err.message);
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = originalText;
            }
        }
    });

    // ==========================================
    // 9. INCOMING OFFERS AND ACTIVE LEASES
    // ==========================================
    async function loadIncomingOffers() {
        if (!incomingOffersList || !activeLeasesList) return;

        incomingOffersList.innerHTML = '<p style="padding:20px; text-align:center; color:#64748b;">Loading incoming offers...</p>';
        activeLeasesList.innerHTML = '<p style="padding:20px; text-align:center; color:#64748b;">Loading active leases...</p>';

        try {
            const { data: negs, error } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    offer_amount,
                    status,
                    created_at,
                    tenant_id,
                    landlord_id,
                    properties (
                        title,
                        location
                    ),
                    tenant:users!tenant_id (
                        full_name
                    )
                `)
                .eq('landlord_id', currentUser.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const negotiations = negs || [];

            const pendingOffers = negotiations.filter(n =>
                String(n.status || '').toLowerCase() === 'pending'
            );

            const acceptedLeases = negotiations.filter(n =>
                String(n.status || '').toLowerCase() === 'accepted'
            );

            if (pendingOffers.length === 0) {
                incomingOffersList.innerHTML = `
                    <div class="empty-state" style="text-align:center; padding:20px;">
                        <i class="ph ph-handshake" style="font-size:2rem; color:#94a3b8;"></i>
                        <h4 style="font-weight:600; margin-top:8px;">No Pending Offers</h4>
                        <p style="color:#64748b; font-size:0.85rem;">Tenant offers will appear here when submitted.</p>
                    </div>
                `;
            } else {
                incomingOffersList.innerHTML = pendingOffers.map(n => `
                    <div class="list-card" style="background:#fff; border:1px solid #e2e8f0; padding:16px; border-radius:8px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                        <div class="list-info">
                            <h4 style="font-weight:600; font-size:1.05rem;">
                                ${n.properties?.title || 'Property'}
                            </h4>

                            <p style="color:#64748b; font-size:0.9rem; margin: 2px 0;">
                                <i class="ph ph-user"></i>
                                Tenant: ${n.tenant?.full_name || 'Tenant Profile'}
                            </p>

                            <p class="offer-text" style="font-size:0.95rem;">
                                Offer:
                                <strong style="color:#2b6cb0;">
                                    GHS ${Number(n.offer_amount || 0).toLocaleString()}/mo
                                </strong>
                            </p>
                        </div>

                        <div style="display:flex; gap:8px; align-items:center; margin-left:auto;">
                            <button
                                class="btn-primary open-chat-btn"
                                data-id="${n.id}"
                                data-title="${n.properties?.title || 'Property Chat'}"
                                data-tenant="${n.tenant?.full_name || 'Tenant'}"
                                style="padding:8px 14px; font-size:0.9rem;">
                                Chat
                            </button>

                            <button
                                class="btn-outline action-status-btn"
                                data-id="${n.id}"
                                data-action="Accepted"
                                style="border-color:#16a34a; color:#16a34a; padding:8px 14px; font-size:0.9rem;">
                                Accept
                            </button>

                            <button
                                class="btn-outline action-status-btn"
                                data-id="${n.id}"
                                data-action="Rejected"
                                style="border-color:#dc2626; color:#dc2626; padding:8px 14px; font-size:0.9rem;">
                                Decline
                            </button>
                        </div>
                    </div>
                `).join('');
            }

            if (acceptedLeases.length === 0) {
                activeLeasesList.innerHTML = `
                    <div class="empty-state" style="text-align:center; padding:20px;">
                        <i class="ph ph-file-dashed" style="font-size:2rem; color:#94a3b8;"></i>
                        <h4 style="font-weight:600; margin-top:8px;">No Active Leases</h4>
                        <p style="color:#64748b; font-size:0.85rem;">Accepted offers will appear here.</p>
                    </div>
                `;
            } else {
                activeLeasesList.innerHTML = acceptedLeases.map(n => `
                    <div class="list-card" style="background:#fff; border:1px solid #e2e8f0; border-left: 4px solid #16a34a; padding:16px; border-radius:8px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                        <div class="list-info">
                            <h4 style="font-weight:600;">
                                ${n.properties?.title || 'Active Rental'}
                            </h4>

                            <p style="color:#64748b; font-size:0.9rem; margin:2px 0;">
                                <i class="ph ph-user"></i>
                                Tenant: ${n.tenant?.full_name || 'Anonymous'}
                            </p>

                            <p class="offer-text" style="font-size:0.95rem;">
                                Agreed Rent:
                                <strong style="color:#16a34a;">
                                    GHS ${Number(n.offer_amount || 0).toLocaleString()}/mo
                                </strong>
                            </p>
                        </div>

                        <div class="status-badge status-accepted" style="margin-left:auto;">
                            Active Lease
                        </div>
                    </div>
                `).join('');
            }
        } catch (err) {
            console.error('Offer loading error:', err.message);

            incomingOffersList.innerHTML = `
                <p style="padding:20px; text-align:center; color:#ef4444;">
                    Failed to load incoming offers: ${err.message}
                </p>
            `;

            activeLeasesList.innerHTML = `
                <p style="padding:20px; text-align:center; color:#ef4444;">
                    Failed to load active leases: ${err.message}
                </p>
            `;
        }
    }

    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.action-status-btn');
        if (!btn) return;

        const negotiationId = btn.getAttribute('data-id');
        const nextStatus = btn.getAttribute('data-action');

        if (!negotiationId || !nextStatus) {
            alert('Invalid negotiation action.');
            return;
        }

        const isAccepting = nextStatus === 'Accepted';

        const confirmMessage = isAccepting
            ? 'Accept this offer? This will mark the property as Occupied and reject other pending offers for this property.'
            : 'Reject this offer?';

        if (!confirm(confirmMessage)) return;

        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = isAccepting ? 'Accepting...' : 'Rejecting...';

        try {
            const { data: negotiation, error: fetchError } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    tenant_id,
                    offer_amount,
                    properties (
                        title
                    )
                `)
                .eq('id', negotiationId)
                .eq('landlord_id', currentUser.id)
                .single();

            if (fetchError) throw fetchError;

            if (isAccepting) {
                const { error } = await supabaseClient.rpc('accept_negotiation', {
                    p_negotiation_id: negotiationId
                });

                if (error) throw error;

                await createNotification(
                    negotiation.tenant_id,
                    'Offer Accepted',
                    `Your offer for "${negotiation.properties?.title || 'a property'}" has been accepted. Check My Lease for the agreement details.`,
                    'success',
                    negotiationId
                );
            } else {
                const { error } = await supabaseClient.rpc('reject_negotiation', {
                    p_negotiation_id: negotiationId
                });

                if (error) throw error;

                await createNotification(
                    negotiation.tenant_id,
                    'Offer Rejected',
                    `Your offer for "${negotiation.properties?.title || 'a property'}" was rejected by the landlord.`,
                    'warning',
                    negotiationId
                );
            }

            await loadOverviewMetrics();
            await loadLandlordProperties();
            await loadIncomingOffers();
            await loadLandlordNotifications();

            alert(isAccepting
                ? 'Offer accepted successfully. The property has been marked as Occupied.'
                : 'Offer rejected successfully.'
            );
        } catch (err) {
            console.error('Offer action error:', err);
            alert('Unable to complete action: ' + (err.message || JSON.stringify(err)));
            btn.disabled = false;
            btn.innerText = originalText;
        }
    });

    // ==========================================
    // 10. CHAT
    // ==========================================
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('.open-chat-btn');
        if (!btn) return;

        activeNegotiationId = btn.getAttribute('data-id');

        const chatTitle = document.getElementById('chat-property-title');
        const chatTenant = document.getElementById('chat-tenant-name');

        if (chatTitle) {
            chatTitle.innerText = btn.getAttribute('data-title') || 'Property Chat';
        }

        if (chatTenant) {
            chatTenant.innerText = 'Tenant: ' + (btn.getAttribute('data-tenant') || 'Tenant');
        }

        if (chatModal) {
            chatModal.style.display = 'flex';
        }

        if (messagesContainer) {
            messagesContainer.innerHTML = '<p style="text-align:center; padding:20px; color:#64748b;">Loading messages...</p>';
        }

        await fetchChatStream();
    });

    document.getElementById('close-chat-btn')?.addEventListener('click', () => {
        if (chatModal) chatModal.style.display = 'none';
        activeNegotiationId = null;
    });

    async function fetchChatStream() {
        if (!activeNegotiationId || !messagesContainer) return;

        try {
            const { data: messages, error } = await supabaseClient
                .from('messages')
                .select('*')
                .eq('negotiation_id', activeNegotiationId)
                .order('created_at', { ascending: true });

            if (error) throw error;

            const chatMessages = messages || [];

            if (chatMessages.length === 0) {
                messagesContainer.innerHTML = `
                    <p style="text-align:center; color:#94a3b8; padding:20px; font-size:0.9rem;">
                        No messages yet.
                    </p>
                `;
                return;
            }

            messagesContainer.innerHTML = chatMessages.map(m => {
                const isMine = m.sender_id === currentUser.id;

                return `
                    <div class="chat-bubble ${isMine ? 'chat-mine' : 'chat-theirs'}">
                        ${m.content}
                    </div>
                `;
            }).join('');

            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } catch (err) {
            messagesContainer.innerHTML = `
                <p style="color:#ef4444; text-align:center; padding:10px;">
                    Failed to load messages: ${err.message}
                </p>
            `;
        }
    }

    chatForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const msgText = chatInput?.value.trim();

        if (!msgText || !activeNegotiationId) return;

        const sendBtn = document.getElementById('send-msg-btn');

        if (sendBtn) sendBtn.disabled = true;

        try {
            const { error } = await supabaseClient
                .from('messages')
                .insert([{
                    negotiation_id: activeNegotiationId,
                    sender_id: currentUser.id,
                    content: msgText
                }]);

            if (error) throw error;

            if (chatInput) chatInput.value = '';

            await fetchChatStream();
        } catch (err) {
            alert('Message failed: ' + err.message);
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    });

    // ==========================================
    // 11. LANDLORD PROFILE UPDATE
    // ==========================================
    landlordProfileForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const saveBtn = document.getElementById('save-profile-btn');
        const originalText = saveBtn ? saveBtn.innerHTML : 'Save Profile';

        if (saveBtn) {
            saveBtn.innerText = 'Saving...';
            saveBtn.disabled = true;
        }

        const name = document.getElementById('profile-name')?.value.trim();
        const phone = document.getElementById('profile-phone')?.value.trim();
        const phoneAlt = document.getElementById('profile-phone-alt')?.value.trim();

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

            await loadUserProfile();

            alert('Profile updated successfully.');
        } catch (err) {
            alert('Profile update failed: ' + err.message);
        } finally {
            if (saveBtn) {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }
    });

    function bindEmailUpdate() {
        updateEmailBtn?.addEventListener('click', async () => {
            const newEmailInput = document.getElementById('profile-new-email');
            const newEmail = newEmailInput?.value.trim();

            if (!newEmail) {
                alert('Please enter the new email address first.');
                return;
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
                alert('Please enter a valid email address.');
                return;
            }

            if (newEmail === currentUser?.email) {
                alert('This is already your current email address.');
                return;
            }

            const confirmed = confirm(
                'Request email update? You may need to confirm this change from your email inbox before it becomes active.'
            );

            if (!confirmed) return;

            const originalText = updateEmailBtn.innerText;
            updateEmailBtn.disabled = true;
            updateEmailBtn.innerText = 'Submitting...';

            try {
                const { error } = await supabaseClient.auth.updateUser({
                    email: newEmail
                });

                if (error) throw error;

                alert('Email update request submitted. Please check your inbox to confirm the change.');

                if (newEmailInput) newEmailInput.value = '';
            } catch (err) {
                alert('Email update failed: ' + err.message);
            } finally {
                updateEmailBtn.disabled = false;
                updateEmailBtn.innerText = originalText;
            }
        });
    }
})();