document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // GLOBAL STATE
    // ==========================================
    let activeNegotiationId = null;
    let currentUser = null;
    let activeChatChannel = null;
    let tenantActivityTimer = null;
    let browsePersonalizationTimer = null;
    let preferredLocationMap = null;
    let preferredLocationMarker = null;
    let preferredLocationAccuracyCircle = null;
    let aiPreferencesLoadedForUser = null;
    let preferredLocationRequestPromise = null;
    let cancelPreferredLocationRequest = null;
    let smartRecommendationRequestSequence = 0;

    const GHANA_MAP_CENTER = [7.9465, -1.0232];
    const LOCATION_PROMPT_SESSION_KEY = 'renthaven-location-prompted';
    const GOOD_LOCATION_ACCURACY_METERS = 100;
    const MAX_USABLE_LOCATION_ACCURACY_METERS = 1500;
    const LOCATION_SAMPLE_WINDOW_MS = 18000;
    const LOCAL_DEFAULT_AVATAR_URL = 'images/default-avatar.svg';

    let authenticatedUserRequest = null;
    let authenticatedUserValidated = false;
    let loginRedirectStarted = false;

    function redirectToLogin() {
        if (loginRedirectStarted) return;

        loginRedirectStarted = true;
        window.location.replace('index.html?auth=required');
    }

    async function getAuthenticatedUser({ redirectIfMissing = false } = {}) {
        if (currentUser?.id && authenticatedUserValidated) {
            return currentUser;
        }

        if (!authenticatedUserRequest) {
            authenticatedUserRequest = (async () => {
                /*
                 * getSession() waits for Supabase to restore the browser session
                 * before any protected dashboard request is allowed to run.
                 */
                const {
                    data: { session },
                    error: sessionError
                } = await supabaseClient.auth.getSession();

                if (sessionError) {
                    throw sessionError;
                }

                if (!session?.user) {
                    return null;
                }

                const {
                    data: { user },
                    error: userError
                } = await supabaseClient.auth.getUser();

                if (userError) {
                    throw userError;
                }

                currentUser = user || session.user;
                authenticatedUserValidated = true;
                return currentUser;
            })();
        }

        try {
            const user = await authenticatedUserRequest;

            if (!user && redirectIfMissing) {
                redirectToLogin();
            }

            return user;
        } finally {
            authenticatedUserRequest = null;
        }
    }

    function setAvatarImage(imageElement, requestedUrl = null) {
        if (!imageElement) return;

        imageElement.onerror = () => {
            imageElement.onerror = null;
            imageElement.src = LOCAL_DEFAULT_AVATAR_URL;
        };

        imageElement.src = requestedUrl || LOCAL_DEFAULT_AVATAR_URL;
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
            currentUser = session.user;
            return;
        }

        if (event === 'SIGNED_OUT') {
            currentUser = null;
            authenticatedUserValidated = false;
            redirectToLogin();
        }
    });

    // ==========================================
    // 1. NAVIGATION LOGIC
    // ==========================================
    const navItems = document.querySelectorAll('.nav-item[data-target]');
    const views = document.querySelectorAll('.view-section');

    function showDashboardSection(sectionId, focusElementId = null) {
        navItems.forEach(nav => {
            nav.classList.toggle('active', nav.getAttribute('data-target') === sectionId);
        });

        views.forEach(view => {
            view.classList.toggle('active-view', view.id === sectionId);
        });

        if (sectionId === 'saved' && typeof loadSavedProperties === 'function') {
            loadSavedProperties();
        }

        if (sectionId === 'lease' && typeof loadTenantLeases === 'function') {
            loadTenantLeases();
        }

        if (sectionId === 'payments' && typeof loadTenantPayments === 'function') {
            loadTenantPayments();
        }

        if (sectionId === 'negotiations' && typeof loadNegotiations === 'function') {
            loadNegotiations();
        }

        if (sectionId === 'recommendations' && typeof loadSmartRecommendations === 'function') {
            loadSmartRecommendations();

            setTimeout(() => {
                preferredLocationMap?.invalidateSize();
            }, 120);
        }

        if (focusElementId) {
            setTimeout(() => {
                const focusEl = document.getElementById(focusElementId);
                if (focusEl) {
                    focusEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 120);
        }
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetName = item.getAttribute('data-target');
            showDashboardSection(targetName);
        });
    });

    // ==========================================
    // 2. LOGOUT LOGIC
    // ==========================================
    const logoutBtn = document.getElementById('logout-btn');
    const profileMenuLogout = document.getElementById('profile-menu-logout');

    async function performLogout(triggerButton = null) {
        const originalText = triggerButton ? triggerButton.innerHTML : '';

        if (triggerButton) {
            triggerButton.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Logging out...';
            triggerButton.style.pointerEvents = 'none';
            triggerButton.disabled = true;
        }

        try {
            if (activeChatChannel) {
                await supabaseClient.removeChannel(activeChatChannel);
            }

            const { error } = await supabaseClient.auth.signOut();

            if (error) throw error;

            window.location.href = 'index.html';
        } catch (error) {
            console.error('Error logging out:', error.message);
            alert('There was a problem logging out. Please try again.');

            if (triggerButton) {
                triggerButton.innerHTML = originalText;
                triggerButton.style.pointerEvents = 'auto';
                triggerButton.disabled = false;
            }
        }
    }

    logoutBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        await performLogout(logoutBtn);
    });

    profileMenuLogout?.addEventListener('click', async (e) => {
        e.preventDefault();
        await performLogout(profileMenuLogout);
    });

    // ==========================================
    // 3. PROFILE MENU AND PROFILE MANAGEMENT
    // ==========================================
    const profileMenuBtn = document.getElementById('profile-menu-btn');
    const profileMenuPanel = document.getElementById('profile-menu-panel');
    const profileMenuName = document.getElementById('profile-menu-name');
    const profileMenuRole = document.getElementById('profile-menu-role');
    const profileMenuViewProfile = document.getElementById('profile-menu-view-profile');
    const profileMenuAccountSettings = document.getElementById('profile-menu-account-settings');

    const profileForm = document.getElementById('profile-form');
    const profileNameInput = document.getElementById('profile-name');
    const profilePhoneInput = document.getElementById('profile-phone');
    const profilePhoneAltInput = document.getElementById('profile-phone-alt');

    const profileCurrentEmailInput = document.getElementById('profile-current-email');
    const profileNewEmailInput = document.getElementById('profile-new-email');
    const updateEmailBtn = document.getElementById('update-email-btn');

    const displayName = document.getElementById('profile-display-name');
    const displayRole = document.getElementById('profile-display-role');
    const displayAvatar = document.getElementById('profile-avatar-display');
    const topbarAvatar = document.getElementById('topbar-avatar');

    function bindProfileMenu() {
        profileMenuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();

            if (!profileMenuPanel) return;

            const isOpen = profileMenuPanel.style.display === 'block';
            profileMenuPanel.style.display = isOpen ? 'none' : 'block';

            if (tenantNotificationPanel) {
                tenantNotificationPanel.style.display = 'none';
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

    async function loadUserProfile(authenticatedUser = null) {
        const user = authenticatedUser || await getAuthenticatedUser();

        if (!user) return;

        if (profileCurrentEmailInput) {
            profileCurrentEmailInput.value = user.email || '';
        }

        if (profileNewEmailInput) {
            profileNewEmailInput.value = '';
        }

        try {
            const { data: profile, error: dbError } = await supabaseClient
                .from('users')
                .select('*')
                .eq('id', user.id)
                .maybeSingle();

            if (dbError) throw dbError;

            if (profile) {
                const fullName = profile.full_name || 'Tenant Account';
                const role = profile.role || 'Tenant';
                const primaryPhone = profile.phone || profile.phone_number || '';
                const alternativePhone = profile.phone_alt || '';

                if (profileNameInput) profileNameInput.value = profile.full_name || '';
                if (profilePhoneInput) profilePhoneInput.value = primaryPhone;
                if (profilePhoneAltInput) profilePhoneAltInput.value = alternativePhone;

                if (displayName) displayName.innerText = fullName;
                if (displayRole) displayRole.innerText = role;

                if (profileMenuName) profileMenuName.innerText = fullName;
                if (profileMenuRole) profileMenuRole.innerText = `${role} Account`;

                const avatarUrl =
                    profile.profile_photo_url ||
                    LOCAL_DEFAULT_AVATAR_URL;

                setAvatarImage(displayAvatar, avatarUrl);
                setAvatarImage(topbarAvatar, avatarUrl);
            }
        } catch (err) {
            console.error('Error loading profile:', err.message);
        }
    }

    bindProfileMenu();

    profileForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!currentUser?.id) {
            alert('User session not found. Please log in again.');
            return;
        }

        const btn = document.getElementById('save-profile-btn');
        if (!btn) return;

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Saving...';
        btn.disabled = true;

        const updatedName = profileNameInput?.value.trim() || '';
        const updatedPhone = profilePhoneInput?.value.trim() || '';
        const updatedPhoneAlt = profilePhoneAltInput?.value.trim() || '';

        try {
            const { error } = await supabaseClient
                .from('users')
                .update({
                    full_name: updatedName,
                    phone: updatedPhone,
                    phone_alt: updatedPhoneAlt
                })
                .eq('id', currentUser.id);

            if (error) throw error;

            await supabaseClient.auth.updateUser({
                data: {
                    full_name: updatedName,
                    phone: updatedPhone,
                    phone_alt: updatedPhoneAlt
                }
            });

            btn.innerHTML = '<i class="ph ph-check"></i> Profile Updated!';
            btn.style.backgroundColor = '#16a34a';

            await loadUserProfile();
        } catch (err) {
            alert('Failed to update profile: ' + err.message);
        } finally {
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = '';
                btn.disabled = false;
            }, 2000);
        }
    });

    function bindEmailUpdate() {
        updateEmailBtn?.addEventListener('click', async () => {
            if (!currentUser?.id) {
                alert('User session not found. Please log in again.');
                return;
            }

            const newEmail = profileNewEmailInput?.value.trim();

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

                if (profileNewEmailInput) profileNewEmailInput.value = '';
            } catch (err) {
                alert('Email update failed: ' + err.message);
            } finally {
                updateEmailBtn.disabled = false;
                updateEmailBtn.innerText = originalText;
            }
        });
    }

    bindEmailUpdate();

    // ==========================================
    // 4. PASSWORD UPDATE
    // ==========================================
    const passwordForm = document.getElementById('password-form');

    passwordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('update-password-btn');
        const newPasswordEl = document.getElementById('new-password');
        const confirmNewPasswordEl = document.getElementById('confirm-new-password');

        if (!btn || !newPasswordEl || !confirmNewPasswordEl) return;

        const newPassword = newPasswordEl.value;
        const confirmNewPassword = confirmNewPasswordEl.value;

        if (!newPassword || newPassword.length < 6) {
            alert('Password must be at least 6 characters.');
            return;
        }

        if (newPassword !== confirmNewPassword) {
            alert('The two passwords do not match. Please check and try again.');
            return;
        }

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Updating...';
        btn.disabled = true;

        try {
            const { error } = await supabaseClient.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

            btn.innerHTML = '<i class="ph ph-check"></i> Password Updated';
            btn.style.backgroundColor = '#16a34a';
            btn.style.borderColor = '#16a34a';
            btn.style.color = 'white';

            newPasswordEl.value = '';
            confirmNewPasswordEl.value = '';
        } catch (error) {
            alert('Failed to update password: ' + error.message);
        } finally {
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.backgroundColor = '';
                btn.style.borderColor = '';
                btn.style.color = '';
                btn.disabled = false;
            }, 3000);
        }
    });

    // ==========================================
    // 5. TENANT NOTIFICATIONS
    // ==========================================
    const tenantNotificationBtn = document.getElementById('tenant-notification-btn');
    const tenantNotificationPanel = document.getElementById('tenant-notification-panel');
    const tenantNotificationList = document.getElementById('tenant-notification-list');
    const tenantNotificationCount = document.getElementById('tenant-notification-count');
    const tenantMarkNotificationsReadBtn = document.getElementById('tenant-mark-notifications-read');

    function bindTenantNotificationUI() {
        tenantNotificationBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();

            if (!tenantNotificationPanel) return;

            const isOpen = tenantNotificationPanel.style.display === 'block';
            tenantNotificationPanel.style.display = isOpen ? 'none' : 'block';

            if (profileMenuPanel) {
                profileMenuPanel.style.display = 'none';
            }

            if (!isOpen) {
                await loadTenantNotifications();
            }
        });

        document.addEventListener('click', (e) => {
            if (!tenantNotificationPanel || !tenantNotificationBtn) return;

            const clickedInsidePanel = tenantNotificationPanel.contains(e.target);
            const clickedBell = tenantNotificationBtn.contains(e.target);

            if (!clickedInsidePanel && !clickedBell) {
                tenantNotificationPanel.style.display = 'none';
            }
        });

        tenantMarkNotificationsReadBtn?.addEventListener('click', async (e) => {
            e.preventDefault();

            const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

            if (authError || !user) {
                alert('Please log in again.');
                return;
            }

            const originalText = tenantMarkNotificationsReadBtn.innerText;
            tenantMarkNotificationsReadBtn.disabled = true;
            tenantMarkNotificationsReadBtn.innerText = 'Updating...';

            try {
                const { error } = await supabaseClient
                    .from('notifications')
                    .update({ is_read: true })
                    .eq('user_id', user.id)
                    .eq('is_read', false);

                if (error) throw error;

                await loadTenantNotifications();
            } catch (err) {
                alert('Unable to mark notifications as read: ' + err.message);
            } finally {
                tenantMarkNotificationsReadBtn.disabled = false;
                tenantMarkNotificationsReadBtn.innerText = originalText;
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

    async function loadTenantNotifications() {
        if (!tenantNotificationList || !tenantNotificationCount) return;

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) return;

        try {
            const { data: notifications, error } = await supabaseClient
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;

            const items = notifications || [];
            const unreadCount = items.filter(item => item.is_read === false).length;

            if (unreadCount > 0) {
                tenantNotificationCount.style.display = 'flex';
                tenantNotificationCount.innerText = unreadCount > 9 ? '9+' : unreadCount;
            } else {
                tenantNotificationCount.style.display = 'none';
                tenantNotificationCount.innerText = '0';
            }

            if (items.length === 0) {
                tenantNotificationList.innerHTML = `
                    <div style="padding: 24px; text-align: center; color: #64748b;">
                        <i class="ph ph-bell-slash" style="font-size: 2rem; color: #94a3b8;"></i>
                        <h4 style="margin: 8px 0 4px 0;">No Notifications</h4>
                        <p style="margin: 0; font-size: 0.85rem;">Offer, lease, and system updates will appear here.</p>
                    </div>
                `;
                return;
            }

            tenantNotificationList.innerHTML = items.map(item => {
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
            console.error('Tenant notification loading error:', err.message);

            tenantNotificationList.innerHTML = `
                <div style="padding: 24px; text-align: center; color: #ef4444;">
                    Unable to load notifications: ${err.message}
                </div>
            `;
        }
    }

    bindTenantNotificationUI();

    // ==========================================
    // 5B. TENANT ACTIVITY TRACKING FOR PERSONALIZED BROWSE
    // ==========================================
    const browseSearchInput = document.getElementById('search-input');
    const browseTypeFilter = document.getElementById('filter-type');
    const browsePriceFilter = document.getElementById('filter-price');
    const browsePropertiesGrid = document.getElementById('properties-grid');

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getBudgetFromPriceFilter(value) {
        if (value === 'low') return 1000;
        if (value === 'mid') return 3000;
        if (value === 'high') return 5000;
        return null;
    }

    async function recordTenantActivity(activity) {
        try {
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

            if (authError || !user) return;

            await supabaseClient
                .from('tenant_activity')
                .insert([{
                    tenant_id: user.id,
                    activity_type: activity.activity_type,
                    property_id: activity.property_id || null,
                    search_location: activity.search_location || null,
                    property_type: activity.property_type || null,
                    budget: activity.budget || null
                }]);
        } catch (error) {
            console.warn('Tenant activity tracking skipped:', error.message);
        }
    }

    function debounceTenantActivity(callback, delay = 700) {
        clearTimeout(tenantActivityTimer);
        tenantActivityTimer = setTimeout(callback, delay);
    }

    function bindBrowseActivityTracking() {
        browseSearchInput?.addEventListener('input', () => {
            const searchValue = browseSearchInput.value.trim();

            if (searchValue.length < 2) return;

            debounceTenantActivity(() => {
                recordTenantActivity({
                    activity_type: 'search_location',
                    search_location: searchValue
                });

                setTimeout(personalizeBrowseRoomCards, 600);
            });
        });

        browseTypeFilter?.addEventListener('change', () => {
            const selectedType = browseTypeFilter.value;

            if (!selectedType || selectedType === 'all') return;

            recordTenantActivity({
                activity_type: 'filter_type',
                property_type: selectedType
            });

            setTimeout(personalizeBrowseRoomCards, 600);
        });

        browsePriceFilter?.addEventListener('change', () => {
            const selectedPrice = browsePriceFilter.value;
            const budget = getBudgetFromPriceFilter(selectedPrice);

            if (!budget) return;

            recordTenantActivity({
                activity_type: 'filter_budget',
                budget
            });

            setTimeout(personalizeBrowseRoomCards, 600);
        });

        document.addEventListener('click', (event) => {
            const propertyCard = event.target.closest('#properties-grid .property-card');
            const viewButton = event.target.closest('#properties-grid button, #properties-grid a');
            const sourceElement = viewButton || propertyCard;

            if (!sourceElement) return;

            const propertyId =
                sourceElement.getAttribute('data-id') ||
                propertyCard?.getAttribute('data-id') ||
                sourceElement.getAttribute('data-property-id') ||
                propertyCard?.getAttribute('data-property-id');

            if (!propertyId) return;

            const typeText = propertyCard?.querySelector('.property-type')?.innerText?.trim() || '';

            recordTenantActivity({
                activity_type: 'view_property',
                property_id: propertyId,
                property_type: typeText || null,
                search_location: null
            });
        }, true);
    }

    async function getTenantPersonalizationSignals() {
        const signals = {
            searchedLocations: new Set(),
            filteredTypes: new Set(),
            viewedPropertyIds: new Set(),
            savedPropertyIds: new Set(),
            negotiatedPropertyIds: new Set(),
            budgets: []
        };

        try {
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

            if (authError || !user) return signals;

            const { data: activities } = await supabaseClient
                .from('tenant_activity')
                .select('*')
                .eq('tenant_id', user.id)
                .order('created_at', { ascending: false })
                .limit(60);

            (activities || []).forEach(activity => {
                if (activity.activity_type === 'search_location' && activity.search_location) {
                    signals.searchedLocations.add(normalizeText(activity.search_location));
                }

                if (activity.property_type) {
                    signals.filteredTypes.add(normalizeText(activity.property_type));
                }

                if (activity.property_id) {
                    signals.viewedPropertyIds.add(activity.property_id);
                }

                if (activity.budget) {
                    signals.budgets.push(Number(activity.budget));
                }
            });

            const { data: savedItems } = await supabaseClient
                .from('saved_properties')
                .select('property_id')
                .eq('user_id', user.id);

            (savedItems || []).forEach(item => {
                if (item.property_id) signals.savedPropertyIds.add(item.property_id);
            });

            const { data: negotiations } = await supabaseClient
                .from('negotiations')
                .select('property_id')
                .eq('tenant_id', user.id);

            (negotiations || []).forEach(item => {
                if (item.property_id) signals.negotiatedPropertyIds.add(item.property_id);
            });
        } catch (error) {
            console.warn('Unable to load tenant personalization signals:', error.message);
        }

        return signals;
    }

    function getCardTextValue(card, selectors) {
        for (const selector of selectors) {
            const element = card.querySelector(selector);

            if (element && element.innerText) {
                return element.innerText.trim();
            }
        }

        return '';
    }

    function getCardPrice(card) {
        const text = card.innerText || '';
        const match = text.match(/(?:GHS|GH₵|₵)\s*([\d,]+)/i);

        if (!match) return 0;

        return Number(String(match[1]).replace(/,/g, '')) || 0;
    }

    function scoreBrowseCard(card, signals) {
        let score = 0;
        const reasons = [];

        const cardId =
            card.getAttribute('data-id') ||
            card.getAttribute('data-property-id') ||
            card.querySelector('[data-id]')?.getAttribute('data-id') ||
            '';

        const cardText = normalizeText(card.innerText || '');
        const cardType = normalizeText(getCardTextValue(card, ['.property-type', '.type', '.property-card-type']));
        const cardPrice = getCardPrice(card);

        if (cardId && signals.savedPropertyIds.has(cardId)) {
            score += 40;
            reasons.push('Saved by you');
        }

        if (cardId && signals.negotiatedPropertyIds.has(cardId)) {
            score += 35;
            reasons.push('You interacted before');
        }

        if (cardId && signals.viewedPropertyIds.has(cardId)) {
            score += 18;
            reasons.push('Viewed before');
        }

        signals.filteredTypes.forEach(type => {
            if (type && (cardType.includes(type) || cardText.includes(type))) {
                score += 25;
                reasons.push('Matches your room type');
            }
        });

        signals.searchedLocations.forEach(location => {
            if (!location) return;

            const locationWords = location.split(' ').filter(word => word.length > 2);

            if (locationWords.some(word => cardText.includes(word))) {
                score += 25;
                reasons.push('Matches your recent location search');
            }
        });

        if (signals.budgets.length > 0 && cardPrice > 0) {
            const highestBudget = Math.max(...signals.budgets);

            if (cardPrice <= highestBudget) {
                score += 15;
                reasons.push('Within your recent budget');
            }
        }

        return {
            score,
            reasons: [...new Set(reasons)]
        };
    }

    function removeBrowseRecommendationLabels() {
        browsePropertiesGrid?.querySelectorAll('.browse-ai-label').forEach(label => label.remove());
    }

    function addBrowseRecommendationLabel(card, score, reasons) {
        if (!card || score < 55) return;

        if (card.querySelector('.browse-ai-label')) return;

        const imageContainer =
            card.querySelector('.image-container') ||
            card.querySelector('.property-image') ||
            card;

        if (imageContainer && imageContainer !== card) {
            imageContainer.style.position = 'relative';
        }

        const label = document.createElement('div');
        label.className = 'browse-ai-label';
        label.innerHTML = '<i class="ph ph-sparkle"></i> Recommended for you';

        label.style.position = 'absolute';
        label.style.top = '10px';
        label.style.left = '10px';
        label.style.zIndex = '3';
        label.style.background = '#ecfdf5';
        label.style.color = '#047857';
        label.style.border = '1px solid #a7f3d0';
        label.style.borderRadius = '999px';
        label.style.padding = '6px 10px';
        label.style.fontSize = '0.72rem';
        label.style.fontWeight = '800';
        label.style.boxShadow = '0 8px 18px rgba(15, 23, 42, 0.12)';

        if (imageContainer && imageContainer !== card) {
            imageContainer.appendChild(label);
        } else {
            card.style.position = 'relative';
            card.appendChild(label);
        }

        card.setAttribute('title', reasons.join(', '));
    }

    async function personalizeBrowseRoomCards() {
        if (!browsePropertiesGrid) return;

        clearTimeout(browsePersonalizationTimer);

        browsePersonalizationTimer = setTimeout(async () => {
            const cards = Array.from(browsePropertiesGrid.querySelectorAll('.property-card'))
                .filter(card => !card.classList.contains('skeleton-card'));

            if (cards.length === 0) return;

            const signals = await getTenantPersonalizationSignals();

            const hasSignals =
                signals.searchedLocations.size > 0 ||
                signals.filteredTypes.size > 0 ||
                signals.viewedPropertyIds.size > 0 ||
                signals.savedPropertyIds.size > 0 ||
                signals.negotiatedPropertyIds.size > 0 ||
                signals.budgets.length > 0;

            if (!hasSignals) return;

            removeBrowseRecommendationLabels();

            const scoredCards = cards.map((card, index) => {
                const match = scoreBrowseCard(card, signals);

                card.dataset.personalScore = String(match.score);
                card.dataset.originalIndex = String(index);

                return {
                    card,
                    score: match.score,
                    reasons: match.reasons,
                    originalIndex: index
                };
            });

            scoredCards.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.originalIndex - b.originalIndex;
            });

            const seenPropertyCards = new Set();

            scoredCards.forEach(item => {
                const propertyId =
                    item.card.getAttribute('data-id') ||
                    item.card.getAttribute('data-property-id');

                if (propertyId && seenPropertyCards.has(propertyId)) {
                    item.card.remove();
                    return;
                }

                if (propertyId) {
                    seenPropertyCards.add(propertyId);
                }

                if (item.score >= 55) {
                    addBrowseRecommendationLabel(item.card, item.score, item.reasons);
                }

                browsePropertiesGrid.appendChild(item.card);
            });
        }, 250);
    }

    bindBrowseActivityTracking();

    if (browsePropertiesGrid) {
        const browseObserver = new MutationObserver(() => {
            personalizeBrowseRoomCards();
        });

        browseObserver.observe(browsePropertiesGrid, {
            childList: true,
            subtree: true
        });
    }

    window.personalizeBrowseRoomCards = personalizeBrowseRoomCards;
    window.recordTenantActivity = recordTenantActivity;

    // ==========================================
    // 6. NEGOTIATIONS AND REALTIME CHAT
    // ==========================================
    const negotiationsList = document.getElementById('negotiations-list');
    const chatModal = document.getElementById('chat-modal');
    const closeChatBtn = document.getElementById('close-chat-btn');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-message-input');
    const messagesContainer = document.getElementById('chat-messages-container');

    async function loadNegotiations() {
        if (!negotiationsList) return;

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) return;

        currentUser = user;

        try {
            const { data, error } = await supabaseClient
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
                    landlord:users!landlord_id (
                        full_name
                    )
                `)
                .eq('tenant_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            renderNegotiations(data || []);
            await loadTenantNotifications();
        } catch (error) {
            console.error('Error loading negotiations:', error.message);

            negotiationsList.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-warning"></i>
                    <h3>Unable to Load Negotiations</h3>
                    <p>${error.message || 'Failed to load negotiations.'}</p>
                </div>
            `;
        }
    }

    function renderNegotiations(negotiations) {
        if (!negotiationsList) return;

        if (!negotiations || negotiations.length === 0) {
            negotiationsList.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-chats"></i>
                    <h3>No Active Negotiations</h3>
                    <p>Start a negotiation from a property details page to see your conversations here.</p>
                </div>
            `;
            return;
        }

        negotiationsList.innerHTML = negotiations.map(neg => {
            const propTitle = neg.properties?.title || 'Specified Property Asset';
            const propLoc = neg.properties?.location || 'Location Pending Mapping';
            const landlordName = neg.landlord?.full_name || 'Asset Owner';

            let badgeClass = 'status-pending';

            if (String(neg.status || '').toLowerCase() === 'accepted') {
                badgeClass = 'status-accepted';
            }

            if (String(neg.status || '').toLowerCase() === 'rejected') {
                badgeClass = 'status-rejected';
            }

            return `
                <div class="list-card">
                    <div class="list-info">
                        <h4>${propTitle}</h4>
                        <p class="text-muted">
                            <i class="ph ph-map-pin"></i> ${propLoc} • Landlord: ${landlordName}
                        </p>
                        <p class="offer-text">
                            Your Offer: <strong>GH₵ ${Number(neg.offer_amount || 0).toLocaleString()}</strong>
                        </p>
                    </div>

                    <div class="status-badge ${badgeClass}">${neg.status || 'Pending'}</div>

                    <button
                        class="btn-outline open-chat-btn"
                        data-id="${neg.id}"
                        data-title="${propTitle}"
                        data-landlord="${landlordName}"
                    >
                        Open Chat Window
                    </button>
                </div>
            `;
        }).join('');
    }

    function appendMessageMarkup(msg) {
        if (!messagesContainer) return;

        if (messagesContainer.innerHTML.includes('No messages yet')) {
            messagesContainer.innerHTML = '';
        }

        const isMine = msg.sender_id === currentUser?.id;

        const bubbleHTML = `
            <div class="chat-bubble ${isMine ? 'chat-mine' : 'chat-theirs'}" data-msg-id="${msg.id}">
                ${msg.content}
            </div>
        `;

        if (!messagesContainer.querySelector(`[data-msg-id="${msg.id}"]`)) {
            messagesContainer.insertAdjacentHTML('beforeend', bubbleHTML);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    function subscribeToRealtimeMessages(negotiationId) {
        if (activeChatChannel) {
            supabaseClient.removeChannel(activeChatChannel);
        }

        activeChatChannel = supabaseClient
            .channel(`public:messages:negotiation:${negotiationId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `negotiation_id=eq.${negotiationId}`
            }, (payload) => {
                appendMessageMarkup(payload.new);
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log(`Live chat connected for negotiation: ${negotiationId}`);
                }
            });
    }

    document.addEventListener('click', async (e) => {
        const openChatBtn = e.target.closest('.open-chat-btn');
        if (!openChatBtn) return;

        activeNegotiationId = openChatBtn.getAttribute('data-id');

        const propTitleNode = document.getElementById('chat-property-title');
        const landlordNameNode = document.getElementById('chat-landlord-name');

        if (propTitleNode) {
            propTitleNode.innerText = openChatBtn.getAttribute('data-title') || 'Property Chat';
        }

        if (landlordNameNode) {
            landlordNameNode.innerText = 'Chatting with ' + (openChatBtn.getAttribute('data-landlord') || 'Landlord');
        }

        if (chatModal) {
            chatModal.style.display = 'flex';
        }

        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <p style="text-align:center; padding: 20px;">
                    Retrieving messaging history...
                </p>
            `;
        }

        await loadMessages(activeNegotiationId);
        subscribeToRealtimeMessages(activeNegotiationId);
    });

    closeChatBtn?.addEventListener('click', () => {
        if (chatModal) chatModal.style.display = 'none';

        if (activeChatChannel) {
            supabaseClient.removeChannel(activeChatChannel);
            activeChatChannel = null;
        }

        activeNegotiationId = null;
    });

    async function loadMessages(negotiationId) {
        try {
            const { data, error } = await supabaseClient
                .from('messages')
                .select('*')
                .eq('negotiation_id', negotiationId)
                .order('created_at', { ascending: true });

            if (error) throw error;

            if (!messagesContainer) return;

            if (!data || data.length === 0) {
                messagesContainer.innerHTML = `
                    <p style="text-align:center; padding: 20px; color:#94a3b8;">
                        No messages yet. Send a message to continue.
                    </p>
                `;
                return;
            }

            messagesContainer.innerHTML = '';
            data.forEach(msg => appendMessageMarkup(msg));
        } catch (error) {
            console.error('Error loading messages:', error.message);

            if (messagesContainer) {
                messagesContainer.innerHTML = `
                    <p style="text-align:center; color:#ef4444;">
                        Failed to load messages.
                    </p>
                `;
            }
        }
    }

    chatForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!chatInput) return;

        const text = chatInput.value.trim();

        if (!text || !activeNegotiationId || !currentUser) return;

        const btn = document.getElementById('send-msg-btn');

        if (btn) btn.disabled = true;

        try {
            const { data, error } = await supabaseClient
                .from('messages')
                .insert([{
                    negotiation_id: activeNegotiationId,
                    sender_id: currentUser.id,
                    content: text
                }])
                .select();

            if (error) throw error;

            chatInput.value = '';

            if (data && data[0]) {
                appendMessageMarkup(data[0]);
            }
        } catch (error) {
            alert('Message delivery failed: ' + error.message);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // ==========================================
    // 7. TENANT ACTIVE LEASES
    // ==========================================
    const tenantLeasesList = document.getElementById('tenant-leases-list');

    async function loadTenantLeases() {
        if (!tenantLeasesList) return;

        tenantLeasesList.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #64748b;">
                <i class="ph ph-spinner ph-spin" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>Loading your active leases...</p>
            </div>
        `;

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            tenantLeasesList.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-lock"></i>
                    <h3>Login Required</h3>
                    <p>Please log in to view your active lease records.</p>
                </div>
            `;
            return;
        }

        currentUser = user;

        try {
            const { data: leases, error } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    tenant_id,
                    landlord_id,
                    property_id,
                    offer_amount,
                    status,
                    created_at,
                    updated_at,
                    properties (
                        id,
                        title,
                        location,
                        price_ghs,
                        type,
                        bedrooms,
                        bathrooms,
                        images,
                        status
                    ),
                    landlord:users!landlord_id (
                        full_name,
                        phone,
                        phone_number,
                        phone_alt
                    ),
                    tenant:users!tenant_id (
                        full_name,
                        phone,
                        phone_number,
                        phone_alt
                    )
                `)
                .eq('tenant_id', user.id)
                .in('status', ['Accepted', 'accepted'])
                .order('updated_at', { ascending: false });

            if (error) throw error;

            if (!leases || leases.length === 0) {
                tenantLeasesList.innerHTML = `
                    <div class="empty-state">
                        <i class="ph ph-file-dashed"></i>
                        <h3>No Active Lease</h3>
                        <p>You do not have any active rental agreements yet. Once a landlord accepts your offer, the lease record will appear here.</p>
                        <button class="btn-primary" onclick="document.querySelector('.nav-item[data-target=\\'browse\\']').click()">
                            Browse Available Rooms
                        </button>
                    </div>
                `;
                return;
            }

            tenantLeasesList.innerHTML = leases.map(lease => {
                const property = lease.properties || {};
                const landlord = lease.landlord || {};

                const propertyTitle = property.title || 'Rental Property';
                const propertyLocation = property.location || 'Location not specified';
                const propertyType = property.type || 'Room';
                const bedrooms = property.bedrooms ?? '-';
                const bathrooms = property.bathrooms ?? '-';
                const landlordName = landlord.full_name || 'Property Owner';
                const landlordPhone = landlord.phone || landlord.phone_number || 'No phone number provided';
                const landlordAltPhone = landlord.phone_alt || '';

                const agreedAmount = Number(lease.offer_amount || 0).toLocaleString('en-GH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });

                const acceptedDateValue = lease.updated_at || lease.created_at;
                const formattedDate = acceptedDateValue
                    ? new Date(acceptedDateValue).toLocaleDateString('en-GH', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })
                    : 'Date not available';

                return `
                    <div class="list-card" style="align-items: flex-start; gap: 18px; flex-wrap: wrap; border-left: 4px solid #16a34a;">
                        <div class="list-info" style="flex: 1; min-width: 260px;">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;">
                                <h4 style="font-size: 1.15rem; margin: 0;">${propertyTitle}</h4>
                                <span class="status-badge status-accepted">Active Lease</span>
                            </div>

                            <p class="text-muted" style="margin-bottom: 8px;">
                                <i class="ph ph-map-pin"></i> ${propertyLocation}
                            </p>

                            <div style="display: flex; gap: 14px; flex-wrap: wrap; color: #64748b; font-size: 0.9rem; margin-bottom: 12px;">
                                <span><i class="ph ph-house"></i> ${propertyType}</span>
                                <span><i class="ph ph-bed"></i> ${bedrooms} Bed</span>
                                <span><i class="ph ph-bathtub"></i> ${bathrooms} Bath</span>
                            </div>

                            <p class="offer-text" style="margin-bottom: 6px;">
                                Agreed Rent: <strong>GH₵ ${agreedAmount} / month</strong>
                            </p>

                            <p class="text-muted" style="font-size: 0.9rem;">
                                Accepted On: ${formattedDate}
                            </p>

                            <p class="text-muted" style="font-size: 0.9rem; margin-top: 6px;">
                                Landlord: <strong>${landlordName}</strong>
                            </p>

                            <p class="text-muted" style="font-size: 0.9rem; margin-top: 6px;">
                                Contact: <strong>${landlordPhone}</strong>
                            </p>

                            ${landlordAltPhone ? `
                                <p class="text-muted" style="font-size: 0.9rem; margin-top: 6px;">
                                    Alternative Contact: <strong>${landlordAltPhone}</strong>
                                </p>
                            ` : ''}
                        </div>

                        <div style="display: flex; flex-direction: column; gap: 10px; min-width: 180px;">
                            <button
                                class="btn-primary pay-rent-btn"
                                data-negotiation-id="${lease.id}"
                                data-tenant-id="${lease.tenant_id}"
                                data-landlord-id="${lease.landlord_id}"
                                data-property-id="${lease.property_id}"
                                data-amount="${Number(lease.offer_amount || property.price_ghs || 0)}"
                                data-email="${currentUser?.email || ''}"
                                data-property-title="${propertyTitle}"
                                style="justify-content: center;"
                            >
                                <i class="ph ph-credit-card"></i> Pay Rent
                            </button>

                            <button
                                class="btn-outline open-chat-btn"
                                data-id="${lease.id}"
                                data-title="${propertyTitle}"
                                data-landlord="${landlordName}"
                                style="justify-content: center;"
                            >
                                <i class="ph ph-chat-circle-text"></i> Open Chat
                            </button>

                            <button
                                class="btn-outline print-lease-btn"
                                data-lease-id="${lease.id}"
                                style="justify-content: center;"
                            >
                                <i class="ph ph-printer"></i> Print Lease
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            await loadTenantNotifications();
        } catch (error) {
            console.error('Error loading active tenant leases:', error);

            tenantLeasesList.innerHTML = `
                <div class="empty-state">
                    <i class="ph ph-warning"></i>
                    <h3>Unable to Load Lease</h3>
                    <p>${error.message || 'Something went wrong while loading your active lease records.'}</p>
                </div>
            `;
        }
    }

    function buildLeaseAgreementHTML(lease) {
        const property = lease.properties || {};
        const landlord = lease.landlord || {};
        const tenant = lease.tenant || {};

        const propertyTitle = property.title || 'Rental Property';
        const propertyLocation = property.location || 'Location not specified';
        const propertyType = property.type || 'Room';
        const bedrooms = property.bedrooms ?? '-';
        const bathrooms = property.bathrooms ?? '-';

        const tenantName = tenant.full_name || 'Tenant';
        const tenantPhone = tenant.phone || tenant.phone_number || 'Not provided';
        const tenantAltPhone = tenant.phone_alt || '';

        const landlordName = landlord.full_name || 'Property Owner';
        const landlordPhone = landlord.phone || landlord.phone_number || 'Not provided';
        const landlordAltPhone = landlord.phone_alt || '';

        const agreedAmount = Number(lease.offer_amount || 0).toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        const acceptedDateValue = lease.updated_at || lease.created_at;
        const acceptedDate = acceptedDateValue
            ? new Date(acceptedDateValue).toLocaleDateString('en-GH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
            : 'Date not available';

        const referenceNumber = `RH-${String(lease.id || '').slice(0, 8).toUpperCase()}`;

        return `
            <div class="lease-print-document">
                <div class="lease-print-header">
                    <h1>RentHaven Ghana</h1>
                    <h2>Residential Lease Agreement</h2>
                    <p>Agreement Reference: <strong>${referenceNumber}</strong></p>
                </div>

                <div class="lease-print-section">
                    <h3>1. Agreement Information</h3>
                    <div class="lease-print-grid">
                        <p><strong>Lease Status:</strong> ${lease.status || 'Accepted'}</p>
                        <p><strong>Accepted Date:</strong> ${acceptedDate}</p>
                        <p><strong>Monthly Rent:</strong> GH₵ ${agreedAmount}</p>
                        <p><strong>Agreement Ref:</strong> ${referenceNumber}</p>
                    </div>
                </div>

                <div class="lease-print-section">
                    <h3>2. Tenant Information</h3>
                    <div class="lease-print-grid">
                        <p><strong>Tenant Name:</strong> ${tenantName}</p>
                        <p><strong>Tenant Contact:</strong> ${tenantPhone}</p>
                        ${tenantAltPhone ? `<p><strong>Tenant Alternative Contact:</strong> ${tenantAltPhone}</p>` : ''}
                    </div>
                </div>

                <div class="lease-print-section">
                    <h3>3. Landlord Information</h3>
                    <div class="lease-print-grid">
                        <p><strong>Landlord Name:</strong> ${landlordName}</p>
                        <p><strong>Landlord Contact:</strong> ${landlordPhone}</p>
                        ${landlordAltPhone ? `<p><strong>Landlord Alternative Contact:</strong> ${landlordAltPhone}</p>` : ''}
                    </div>
                </div>

                <div class="lease-print-section">
                    <h3>4. Property Information</h3>
                    <div class="lease-print-grid">
                        <p><strong>Property:</strong> ${propertyTitle}</p>
                        <p><strong>Location:</strong> ${propertyLocation}</p>
                        <p><strong>Property Type:</strong> ${propertyType}</p>
                        <p><strong>Bedrooms:</strong> ${bedrooms}</p>
                        <p><strong>Bathrooms:</strong> ${bathrooms}</p>
                    </div>
                </div>

                <div class="lease-print-section">
                    <h3>5. Basic Terms and Conditions</h3>
                    <ol>
                        <li>The tenant agrees to pay the agreed monthly rent of GH₵ ${agreedAmount} to the landlord.</li>
                        <li>The landlord confirms that the listed property is available for rental under the agreed terms.</li>
                        <li>The tenant shall keep the property in good condition during the tenancy period.</li>
                        <li>Any damage caused by misuse shall be reported and resolved between the tenant and landlord.</li>
                        <li>This agreement is generated from the RentHaven Ghana rental platform based on an accepted offer.</li>
                        <li>Both parties are advised to keep a signed copy of this agreement for personal records.</li>
                    </ol>
                </div>

                <div class="lease-print-section">
                    <h3>6. Signatures</h3>

                    <div class="lease-signature-grid">
                        <div>
                            <p class="signature-line"></p>
                            <p><strong>Tenant Signature</strong></p>
                            <p>Date: ____________________</p>
                        </div>

                        <div>
                            <p class="signature-line"></p>
                            <p><strong>Landlord Signature</strong></p>
                            <p>Date: ____________________</p>
                        </div>
                    </div>
                </div>

                <div class="lease-print-footer">
                    <p>This document was generated electronically by RentHaven Ghana.</p>
                </div>
            </div>
        `;
    }

    document.addEventListener('click', async (e) => {
        const printBtn = e.target.closest('.print-lease-btn');
        if (!printBtn) return;

        const leaseId = printBtn.getAttribute('data-lease-id');

        if (!leaseId) {
            alert('Lease record not found.');
            return;
        }

        const originalText = printBtn.innerHTML;
        printBtn.disabled = true;
        printBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Preparing...';

        try {
            const { data: lease, error } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    offer_amount,
                    status,
                    created_at,
                    updated_at,
                    properties (
                        id,
                        title,
                        location,
                        price_ghs,
                        type,
                        bedrooms,
                        bathrooms,
                        images,
                        status
                    ),
                    landlord:users!landlord_id (
                        full_name,
                        phone,
                        phone_number,
                        phone_alt
                    ),
                    tenant:users!tenant_id (
                        full_name,
                        phone,
                        phone_number,
                        phone_alt
                    )
                `)
                .eq('id', leaseId)
                .in('status', ['Accepted', 'accepted'])
                .single();

            if (error) throw error;

            const printArea = document.getElementById('print-lease-area');

            if (!printArea) {
                alert('Print area is missing. Add <div id="print-lease-area" style="display: none;"></div> to tenant-dashboard.html.');
                return;
            }

            printArea.innerHTML = buildLeaseAgreementHTML(lease);

            setTimeout(() => {
                window.print();
            }, 300);
        } catch (error) {
            console.error('Print lease error:', error);
            alert('Unable to prepare lease agreement: ' + error.message);
        } finally {
            printBtn.disabled = false;
            printBtn.innerHTML = originalText;
        }
    });

    // ==========================================
    // 7B. PAYMENTS + BLOCKCHAIN LEDGER
    // ==========================================
    const paymentActiveLeaseCount = document.getElementById('payment-active-lease-count');
    const paymentPaidCount = document.getElementById('payment-paid-count');
    const paymentLedgerCount = document.getElementById('payment-ledger-count');
    const tenantPaymentCard = document.getElementById('tenant-payment-card');
    const tenantPaymentHistory = document.getElementById('tenant-payment-history');

    function formatGhsAmount(value) {
        return Number(value || 0).toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatPaymentDate(value) {
        if (!value) return 'Not available';

        return new Date(value).toLocaleDateString('en-GH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function getPaymentStatusBadge(status) {
        const cleanStatus = String(status || 'pending').toLowerCase();

        let icon = 'ph-clock';

        if (cleanStatus === 'paid') icon = 'ph-check-circle';
        if (cleanStatus === 'failed' || cleanStatus === 'cancelled') icon = 'ph-warning-circle';

        return `
            <span class="payment-status ${cleanStatus}">
                <i class="ph ${icon}"></i>
                ${cleanStatus}
            </span>
        `;
    }

    async function loadTenantPayments() {
        if (!tenantPaymentCard || !tenantPaymentHistory) return;

        tenantPaymentCard.innerHTML = `
            <div class="payment-empty-state">
                <i class="ph ph-spinner ph-spin"></i>
                <h4>Loading payment details</h4>
                <p>Please wait while we check your accepted lease and payment records.</p>
            </div>
        `;

        tenantPaymentHistory.innerHTML = `
            <div class="payment-empty-state small">
                <i class="ph ph-spinner ph-spin"></i>
                <p>Loading payment history...</p>
            </div>
        `;

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            tenantPaymentCard.innerHTML = `
                <div class="payment-empty-state">
                    <i class="ph ph-lock"></i>
                    <h4>Login required</h4>
                    <p>Please log in again to view and make rent payments.</p>
                </div>
            `;
            return;
        }

        currentUser = user;

        try {
            const { data: acceptedLeases, error: leaseError } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    tenant_id,
                    landlord_id,
                    property_id,
                    offer_amount,
                    status,
                    created_at,
                    updated_at,
                    properties (
                        id,
                        title,
                        location,
                        price_ghs,
                        type,
                        bedrooms,
                        bathrooms,
                        status
                    ),
                    landlord:users!landlord_id (
                        full_name,
                        email,
                        phone,
                        phone_number
                    )
                `)
                .eq('tenant_id', user.id)
                .in('status', ['Accepted', 'accepted'])
                .order('updated_at', { ascending: false });

            if (leaseError) throw leaseError;

            const { data: payments, error: paymentError } = await supabaseClient
                .from('payments')
                .select(`
                    id,
                    tenant_id,
                    landlord_id,
                    property_id,
                    negotiation_id,
                    amount,
                    currency,
                    payment_status,
                    payment_reference,
                    payment_provider,
                    payment_channel,
                    receipt_url,
                    paid_at,
                    created_at,
                    properties (
                        title,
                        location
                    )
                `)
                .eq('tenant_id', user.id)
                .order('created_at', { ascending: false });

            if (paymentError) throw paymentError;

            const landlordIds = [...new Set((payments || []).map(item => item.landlord_id).filter(Boolean))];

            let landlordMap = {};

            if (landlordIds.length > 0) {
                const { data: landlordRows } = await supabaseClient
                    .from('users')
                    .select('id, full_name')
                    .in('id', landlordIds);

                landlordMap = (landlordRows || []).reduce((map, item) => {
                    map[item.id] = item.full_name;
                    return map;
                }, {});
            }

            const { count: paidCount } = await supabaseClient
                .from('payments')
                .select('id', { count: 'exact', head: true })
                .eq('tenant_id', user.id)
                .eq('payment_status', 'paid');

            const { count: ledgerCount } = await supabaseClient
                .from('payment_ledger')
                .select('id', { count: 'exact', head: true })
                .eq('tenant_id', user.id);

            if (paymentActiveLeaseCount) {
                paymentActiveLeaseCount.innerText = String((acceptedLeases || []).length);
            }

            if (paymentPaidCount) {
                paymentPaidCount.innerText = String(paidCount || 0);
            }

            if (paymentLedgerCount) {
                paymentLedgerCount.innerText = String(ledgerCount || 0);
            }

            renderTenantPaymentCard(acceptedLeases || [], payments || [], user);
            renderTenantPaymentHistory(payments || [], landlordMap);
        } catch (error) {
            console.error('Unable to load tenant payments:', error.message);

            tenantPaymentCard.innerHTML = `
                <div class="payment-empty-state">
                    <i class="ph ph-warning-circle"></i>
                    <h4>Unable to load payments</h4>
                    <p>${error.message || 'Something went wrong while loading your payment records.'}</p>
                </div>
            `;

            tenantPaymentHistory.innerHTML = `
                <div class="payment-empty-state small">
                    <i class="ph ph-warning-circle"></i>
                    <p>Unable to load payment history.</p>
                </div>
            `;
        }
    }

    function renderTenantPaymentCard(acceptedLeases, payments, user) {
        if (!tenantPaymentCard) return;

        if (!acceptedLeases || acceptedLeases.length === 0) {
            tenantPaymentCard.innerHTML = `
                <div class="payment-empty-state">
                    <i class="ph ph-hourglass-medium"></i>
                    <h4>No accepted lease found</h4>
                    <p>
                        Once a landlord accepts your offer, the property, rent amount,
                        landlord details, and secure Pay Rent button will appear here.
                    </p>
                </div>
            `;
            return;
        }

        const lease = acceptedLeases[0];
        const property = lease.properties || {};
        const landlord = lease.landlord || {};

        const propertyTitle = property.title || 'Rental Property';
        const propertyLocation = property.location || 'Location not specified';
        const landlordName = landlord.full_name || 'Landlord';
        const landlordPhone = landlord.phone || landlord.phone_number || 'Not provided';
        const amount = Number(lease.offer_amount || property.price_ghs || 0);

        const existingPaidPayment = payments.find(payment =>
            payment.negotiation_id === lease.id &&
            String(payment.payment_status || '').toLowerCase() === 'paid'
        );

        const existingPendingPayment = payments.find(payment =>
            payment.negotiation_id === lease.id &&
            String(payment.payment_status || '').toLowerCase() === 'pending'
        );

        const acceptedDate = formatPaymentDate(lease.updated_at || lease.created_at);

        tenantPaymentCard.innerHTML = `
            <div class="lease-payment-details">
                <div class="lease-payment-top">
                    <div>
                        <h4>${propertyTitle}</h4>
                        <p><i class="ph ph-map-pin"></i> ${propertyLocation}</p>
                    </div>

                    <div class="payment-amount">
                        <span>Agreed rent</span>
                        <strong>GHS ${formatGhsAmount(amount)}</strong>
                    </div>
                </div>

                <div class="payment-detail-grid">
                    <div class="payment-detail-item">
                        <span>Landlord</span>
                        <strong>${landlordName}</strong>
                    </div>

                    <div class="payment-detail-item">
                        <span>Contact</span>
                        <strong>${landlordPhone}</strong>
                    </div>

                    <div class="payment-detail-item">
                        <span>Accepted on</span>
                        <strong>${acceptedDate}</strong>
                    </div>

                    <div class="payment-detail-item">
                        <span>Payment status</span>
                        <strong>${existingPaidPayment ? 'Paid' : existingPendingPayment ? 'Pending' : 'Not paid'}</strong>
                    </div>
                </div>

                ${
                    existingPaidPayment
                        ? `
                            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; padding: 14px; border-radius: 14px; font-weight: 700;">
                                <i class="ph ph-check-circle"></i>
                                This lease payment has been verified and secured in the blockchain ledger.
                                <br>
                                <small style="color: #065f46;">Reference: ${existingPaidPayment.payment_reference || 'N/A'}</small>
                            </div>
                        `
                        : `
                            <div class="payment-actions">
                                <button
                                    class="btn-primary pay-rent-btn"
                                    data-negotiation-id="${lease.id}"
                                    data-tenant-id="${lease.tenant_id}"
                                    data-landlord-id="${lease.landlord_id}"
                                    data-property-id="${lease.property_id}"
                                    data-amount="${amount}"
                                    data-email="${user.email || ''}"
                                    data-property-title="${propertyTitle}"
                                >
                                    <i class="ph ph-credit-card"></i>
                                    Pay Rent Securely
                                </button>

                                <button
                                    class="btn-outline"
                                    type="button"
                                    onclick="document.querySelector('.nav-item[data-target=\\'lease\\']')?.click()"
                                >
                                    <i class="ph ph-file-text"></i>
                                    View Lease
                                </button>
                            </div>

                            <p style="font-size: 0.82rem; color: #64748b; margin: 0;">
                                You will be redirected to Paystack checkout. RentHaven will verify the payment and create a blockchain ledger block after success.
                            </p>
                        `
                }
            </div>
        `;
    }

    function renderTenantPaymentHistory(payments, landlordMap = {}) {
        if (!tenantPaymentHistory) return;

        if (!payments || payments.length === 0) {
            tenantPaymentHistory.innerHTML = `
                <div class="payment-empty-state small">
                    <i class="ph ph-receipt"></i>
                    <p>No payment history yet.</p>
                </div>
            `;
            return;
        }

        tenantPaymentHistory.innerHTML = payments.map(payment => {
            const propertyTitle = payment.properties?.title || 'Rental Payment';
            const propertyLocation = payment.properties?.location || 'Location not specified';
            const landlordName = landlordMap[payment.landlord_id] || 'Landlord';
            const reference = payment.payment_reference || 'No reference';
            const dateValue = payment.paid_at || payment.created_at;

            return `
                <div class="payment-history-item">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                        <div>
                            <h4>${propertyTitle}</h4>
                            <p><i class="ph ph-map-pin"></i> ${propertyLocation}</p>
                            <p>Landlord: <strong>${landlordName}</strong></p>
                        </div>

                        ${getPaymentStatusBadge(payment.payment_status)}
                    </div>

                    <p>Amount: <strong>GHS ${formatGhsAmount(payment.amount)}</strong></p>
                    <p>Reference: <strong>${reference}</strong></p>
                    <p>Date: ${formatPaymentDate(dateValue)}</p>

                    ${
                        payment.receipt_url
                            ? `<a href="${payment.receipt_url}" target="_blank" rel="noopener" class="btn-outline" style="margin-top: 8px; display: inline-flex;">View Receipt</a>`
                            : ''
                    }
                </div>
            `;
        }).join('');
    }

    async function startTenantRentPayment(button) {
        if (!button) return;

        const originalText = button.innerHTML;

        button.disabled = true;
        button.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Starting payment...';

        try {
            const {
                data: { session },
                error: sessionError
            } = await supabaseClient.auth.getSession();

            if (sessionError) {
                throw new Error('Unable to verify your login session.');
            }

            if (!session?.access_token) {
                throw new Error('Your login session has expired. Please log in again.');
            }

            const propertyId = button.getAttribute('data-property-id');
            const negotiationId =
                button.getAttribute('data-negotiation-id') || null;

            if (!propertyId) {
                throw new Error(
                    'Missing property information. Please refresh the page.'
                );
            }

            const paymentPayload = {
                property_id: propertyId,
                negotiation_id: negotiationId
            };

            const response = await fetch('/.netlify/functions/initialize-payment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`
                },
                body: JSON.stringify(paymentPayload)
            });

            const responseText = await response.text();
            let result = {};

            try {
                result = responseText ? JSON.parse(responseText) : {};
            } catch {
                result = {};
            }

            if (response.status === 401) {
                throw new Error(
                    'Your login session is invalid or expired. Please log in again.'
                );
            }

            if (!response.ok || !result.authorization_url) {
                throw new Error(result.error || result.details?.message || 'Unable to start payment.');
            }

            window.location.href = result.authorization_url;
        } catch (error) {
            alert('Payment could not start: ' + error.message);
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }

    document.addEventListener('click', (event) => {
        const payBtn = event.target.closest('.pay-rent-btn');

        if (!payBtn) return;

        event.preventDefault();
        startTenantRentPayment(payBtn);
    });

    window.loadTenantPayments = loadTenantPayments;

    // ==========================================
    // 8. TENANT SAVED SPACES
    // ==========================================
    const savedPropertiesGrid = document.getElementById('saved-properties-grid');

    async function loadSavedProperties() {
        if (!savedPropertiesGrid) return;

        savedPropertiesGrid.innerHTML = `
            <div style="text-align: center; grid-column: 1 / -1; padding: 40px; color: #64748b;">
                <i class="ph ph-spinner ph-spin" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>Loading your saved spaces...</p>
            </div>
        `;

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            savedPropertiesGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-lock"></i>
                    <h3>Login Required</h3>
                    <p>Please log in to view your saved properties.</p>
                </div>
            `;
            return;
        }

        try {
            const { data: savedItems, error } = await supabaseClient
                .from('saved_properties')
                .select(`
                    id,
                    created_at,
                    property_id,
                    properties (
                        id,
                        title,
                        location,
                        price_ghs,
                        status,
                        type,
                        bedrooms,
                        bathrooms,
                        images,
                        amenities
                    )
                `)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!savedItems || savedItems.length === 0) {
                savedPropertiesGrid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <i class="ph ph-heart-break"></i>
                        <h3>No saved spaces yet</h3>
                        <p>When you see a room you like, click the heart icon to save it here for easy comparison.</p>
                        <button class="btn-primary" onclick="document.querySelector('.nav-item[data-target=\\'browse\\']').click()">
                            Go Browse Rooms
                        </button>
                    </div>
                `;
                return;
            }

            savedPropertiesGrid.innerHTML = savedItems.map(item => {
                const property = item.properties;

                if (!property) return '';

                let imageUrl = 'https://via.placeholder.com/400x250?text=No+Image+Available';

                if (Array.isArray(property.images) && property.images.length > 0) {
                    imageUrl = property.images[0];
                }

                const amenities = property.amenities || {};
                const beds = property.bedrooms ?? amenities.beds ?? '-';
                const baths = property.bathrooms ?? amenities.baths ?? '-';
                const propType = property.type || amenities.type || 'Listing Asset';

                const price = Number(property.price_ghs || 0).toLocaleString('en-GH', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                });

                const isAvailable = property.status === 'Available';

                return `
                    <div class="property-card saved-property-card" data-id="${property.id}">
                        <div class="image-container">
                            <img src="${imageUrl}" alt="${property.title || 'Saved Property'}" loading="lazy">
                        </div>

                        <div class="card-content">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                                <div class="property-type">${propType}</div>
                                <span class="status-badge ${isAvailable ? 'status-accepted' : 'status-pending'}">
                                    ${property.status || 'Unknown'}
                                </span>
                            </div>

                            <h3 class="property-card-title" style="margin: 8px 0; font-size: 1.15rem; font-weight: 600;">
                                ${property.title || 'Untitled Property'}
                            </h3>

                            <div class="location" style="display: flex; align-items: center; gap: 4px; color: #64748b; margin-bottom: 12px;">
                                <i class="ph ph-map-pin"></i> ${property.location || 'Location Unspecified'}
                            </div>

                            <div class="features-summary" style="display: flex; gap: 16px; color: #64748b; font-size: 0.9rem; margin-bottom: 16px;">
                                <span style="display: flex; align-items: center; gap: 6px;">
                                    <i class="ph ph-bed"></i> ${beds} Bed
                                </span>
                                <span style="display: flex; align-items: center; gap: 6px;">
                                    <i class="ph ph-bathtub"></i> ${baths} Bath
                                </span>
                            </div>

                            <div class="price-container" style="display: flex; align-items: baseline; gap: 4px;">
                                <div class="price" style="font-size: 1.25rem; font-weight: 700; color: #0d8abc;">
                                    GHS ${price}
                                </div>
                                <span class="price-period" style="color: #64748b; font-size: 0.9rem;">/ month</span>
                            </div>

                            <div style="display: flex; gap: 8px; margin-top: 16px;">
                                <button
                                    class="btn-outline remove-saved-btn"
                                    data-id="${property.id}"
                                    style="padding: 12px; display: flex; align-items: center; justify-content: center; width: 48px; min-width: 48px;"
                                    aria-label="Remove Saved Property"
                                >
                                    <i class="ph-fill ph-heart" style="font-size: 1.2rem; color: #e53e3e;"></i>
                                </button>

                                <button
                                    class="btn-primary view-saved-property-btn"
                                    data-id="${property.id}"
                                    style="flex: 1;"
                                    ${isAvailable ? '' : 'disabled'}
                                >
                                    ${isAvailable ? 'View Details' : 'Not Available'}
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            if (!savedPropertiesGrid.innerHTML.trim()) {
                savedPropertiesGrid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <i class="ph ph-heart-break"></i>
                        <h3>No saved spaces found</h3>
                        <p>Your saved properties may have been removed by the landlord.</p>
                    </div>
                `;
            }

            await loadTenantNotifications();
        } catch (error) {
            console.error('Error loading saved properties:', error);

            savedPropertiesGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-warning"></i>
                    <h3>Unable to Load Saved Spaces</h3>
                    <p>${error.message || 'Something went wrong while loading your saved properties.'}</p>
                </div>
            `;
        }
    }

    window.loadSavedProperties = loadSavedProperties;

    window.addEventListener('saved-properties-updated', () => {
        loadSavedProperties();

        if (typeof loadSmartRecommendations === 'function') {
            loadSmartRecommendations();
        }
    });

    document.addEventListener('click', async (e) => {
        const viewBtn = e.target.closest('.view-saved-property-btn');
        const removeBtn = e.target.closest('.remove-saved-btn');

        if (viewBtn) {
            const propertyId = viewBtn.getAttribute('data-id');

            if (propertyId) {
                recordTenantActivity({
                    activity_type: 'view_property',
                    property_id: propertyId
                });

                window.location.href = `property-details.html?id=${propertyId}`;
            }

            return;
        }

        if (removeBtn) {
            const propertyId = removeBtn.getAttribute('data-id');

            if (!propertyId) {
                alert('Invalid saved property.');
                return;
            }

            const confirmed = confirm('Remove this property from your saved spaces?');
            if (!confirmed) return;

            removeBtn.disabled = true;

            try {
                const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

                if (authError || !user) {
                    alert('Please log in again.');
                    removeBtn.disabled = false;
                    return;
                }

                const { error } = await supabaseClient
                    .from('saved_properties')
                    .delete()
                    .match({
                        user_id: user.id,
                        property_id: propertyId
                    });

                if (error) throw error;

                await loadSavedProperties();

                window.dispatchEvent(new CustomEvent('saved-properties-updated', {
                    detail: {
                        propertyId: propertyId,
                        saved: false
                    }
                }));
            } catch (error) {
                console.error('Error removing saved property:', error);
                alert('Unable to remove saved property: ' + error.message);
                removeBtn.disabled = false;
            }
        }
    });

    // ==========================================
    // 9. LOCATION-AWARE SMART AI RECOMMENDATIONS
    // ==========================================
    const smartRecommendationsGrid = document.getElementById('smart-recommendations-grid');
    const aiLocationInput = document.getElementById('ai-location');
    const aiTypeInput = document.getElementById('ai-type');
    const aiBudgetInput = document.getElementById('ai-budget');
    const aiBedroomsInput = document.getElementById('ai-bedrooms');
    const aiRadiusInput = document.getElementById('ai-radius');
    const aiLatitudeInput = document.getElementById('ai-latitude');
    const aiLongitudeInput = document.getElementById('ai-longitude');
    const aiLocationStatus = document.getElementById('ai-location-status');
    const useCurrentLocationBtn = document.getElementById('use-current-location-btn');
    const generateAiMatchBtn = document.getElementById('generate-ai-match-btn');
    const refreshRecommendationsBtn = document.getElementById('refresh-recommendations-btn');
    const aiSummaryCard = document.getElementById('ai-summary-card');
    const aiSummaryText = document.getElementById('ai-summary-text');

    function setPreferredMapPosition(
        latitude,
        longitude,
        shouldCenter = true,
        locationDetails = {}
    ) {
        if (
            latitude === null ||
            latitude === undefined ||
            latitude === '' ||
            longitude === null ||
            longitude === undefined ||
            longitude === ''
        ) {
            return false;
        }

        const lat = Number(latitude);
        const lng = Number(longitude);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            lat < -90 ||
            lat > 90 ||
            lng < -180 ||
            lng > 180
        ) {
            return false;
        }

        if (locationDetails.source === 'manual') {
            /*
              A manual map click is an intentional, precise fallback. Cancel any
              in-progress desktop geolocation sampling so its later timeout
              cannot show a stale poor-accuracy warning over the chosen pin.
            */
            cancelPreferredLocationRequest?.();

            try {
                sessionStorage.setItem(LOCATION_PROMPT_SESSION_KEY, 'yes');
            } catch {
                // Matching still works when browser storage is unavailable.
            }
        }

        if (aiLatitudeInput) aiLatitudeInput.value = lat.toFixed(7);
        if (aiLongitudeInput) aiLongitudeInput.value = lng.toFixed(7);

        if (preferredLocationMap && window.L) {
            if (!preferredLocationMarker) {
                preferredLocationMarker = L.marker([lat, lng]).addTo(preferredLocationMap);
            } else {
                preferredLocationMarker.setLatLng([lat, lng]);
            }

            if (preferredLocationAccuracyCircle) {
                preferredLocationMap.removeLayer(preferredLocationAccuracyCircle);
                preferredLocationAccuracyCircle = null;
            }

            const accuracy = Number(locationDetails.accuracy);

            if (
                locationDetails.source === 'device' &&
                Number.isFinite(accuracy) &&
                accuracy > 0
            ) {
                preferredLocationAccuracyCircle = L.circle([lat, lng], {
                    radius: accuracy,
                    color: accuracy <= GOOD_LOCATION_ACCURACY_METERS
                        ? '#047857'
                        : '#d97706',
                    fillColor: accuracy <= GOOD_LOCATION_ACCURACY_METERS
                        ? '#10b981'
                        : '#f59e0b',
                    fillOpacity: 0.12,
                    weight: 2
                }).addTo(preferredLocationMap);
            }

            if (shouldCenter) {
                if (
                    preferredLocationAccuracyCircle &&
                    Number(locationDetails.accuracy) > 250
                ) {
                    preferredLocationMap.fitBounds(
                        preferredLocationAccuracyCircle.getBounds(),
                        {
                            padding: [24, 24],
                            maxZoom: 16
                        }
                    );
                } else {
                    preferredLocationMap.setView([lat, lng], 16);
                }
            }
        }

        if (aiLocationStatus) {
            const accuracy = Number(locationDetails.accuracy);

            if (
                locationDetails.source === 'device' &&
                Number.isFinite(accuracy)
            ) {
                const accuracyLabel = accuracy >= 1000
                    ? `${(accuracy / 1000).toFixed(1)} km`
                    : `${Math.round(accuracy)} m`;

                aiLocationStatus.innerText =
                    `Current location selected — estimated accuracy: ${accuracyLabel}.`;
                aiLocationStatus.style.color =
                    accuracy <= GOOD_LOCATION_ACCURACY_METERS
                        ? '#047857'
                        : '#b45309';
            } else {
                aiLocationStatus.innerText =
                    `Preferred point selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                aiLocationStatus.style.color = '#047857';
            }
        }

        return true;
    }

    function initializePreferredLocationMap(latitude = null, longitude = null) {
        const mapElement = document.getElementById('preferred-location-map');

        if (!mapElement) return;

        if (!window.L) {
            if (aiLocationStatus) {
                aiLocationStatus.innerText = 'The map could not load. Check your internet connection and reopen Smart AI Match.';
                aiLocationStatus.style.color = '#b91c1c';
            }
            return;
        }

        if (!preferredLocationMap) {
            preferredLocationMap = L.map(mapElement).setView(GHANA_MAP_CENTER, 7);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(preferredLocationMap);

            preferredLocationMap.on('click', event => {
                setPreferredMapPosition(
                    event.latlng.lat,
                    event.latlng.lng,
                    true,
                    { source: 'manual' }
                );
            });
        }

        const hasCoordinates = setPreferredMapPosition(latitude, longitude);

        if (!hasCoordinates && !preferredLocationMarker) {
            preferredLocationMap.setView(GHANA_MAP_CENTER, 7);
        }

        setTimeout(() => {
            preferredLocationMap?.invalidateSize();
        }, 120);
    }

    function requestCurrentPositionForPreferences({ automatic = false } = {}) {
        if (!navigator.geolocation) {
            const message =
                'Your browser does not support location access. Click your preferred point on the map instead.';

            if (aiLocationStatus) {
                aiLocationStatus.innerText = message;
                aiLocationStatus.style.color = '#b45309';
            }

            if (!automatic) alert(message);
            return Promise.resolve(false);
        }

        if (preferredLocationRequestPromise) {
            return preferredLocationRequestPromise;
        }

        const originalText = useCurrentLocationBtn?.innerHTML || '';

        if (useCurrentLocationBtn) {
            useCurrentLocationBtn.disabled = true;
            useCurrentLocationBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Locating...';
        }

        if (aiLocationStatus) {
            aiLocationStatus.innerText =
                'Waiting for location permission from your browser...';
            aiLocationStatus.style.color = '#475569';
        }

        preferredLocationRequestPromise = new Promise(resolve => {
            let bestPosition = null;
            let watchId = null;
            let sampleTimer = null;
            let finished = false;

            const finish = (success, message = '') => {
                if (finished) return;
                finished = true;

                if (watchId !== null) {
                    navigator.geolocation.clearWatch(watchId);
                }

                clearTimeout(sampleTimer);
                cancelPreferredLocationRequest = null;

                if (!success && message && aiLocationStatus) {
                    aiLocationStatus.innerText = message;
                    aiLocationStatus.style.color = '#b45309';
                }

                if (!success && message && !automatic) {
                    alert(message);
                }

                resolve(success);
            };

            cancelPreferredLocationRequest = () => {
                finish(false);
            };

            const acceptBestPosition = () => {
                if (!bestPosition) {
                    finish(
                        false,
                        'Your device did not return a location. Click your actual area on the map instead.'
                    );
                    return;
                }

                const accuracy = Number(bestPosition.coords.accuracy);

                if (
                    !Number.isFinite(accuracy) ||
                    accuracy > MAX_USABLE_LOCATION_ACCURACY_METERS
                ) {
                    const accuracyLabel = Number.isFinite(accuracy)
                        ? (
                            accuracy >= 1000
                                ? `${(accuracy / 1000).toFixed(1)} km`
                                : `${Math.round(accuracy)} m`
                        )
                        : 'unknown';

                    const currentPreferences = getAiPreferences();
                    const hasSelectedMapPoint =
                        Number.isFinite(currentPreferences.latitude) &&
                        Number.isFinite(currentPreferences.longitude);
                    const fallbackInstruction = hasSelectedMapPoint
                        ? 'Your existing selected map point remains active for AI matching.'
                        : 'Click your actual area on the map.';

                    finish(
                        false,
                        `Your device could only estimate your location within ${accuracyLabel}, so it was not used for AI matching. ${fallbackInstruction}`
                    );
                    return;
                }

                setPreferredMapPosition(
                    bestPosition.coords.latitude,
                    bestPosition.coords.longitude,
                    true,
                    {
                        source: 'device',
                        accuracy
                    }
                );

                finish(true);
            };

            sampleTimer = setTimeout(
                acceptBestPosition,
                LOCATION_SAMPLE_WINDOW_MS
            );

            watchId = navigator.geolocation.watchPosition(
                position => {
                    const accuracy = Number(position.coords.accuracy);
                    const bestAccuracy = Number(
                        bestPosition?.coords?.accuracy
                    );

                    if (
                        !bestPosition ||
                        (
                            Number.isFinite(accuracy) &&
                            (
                                !Number.isFinite(bestAccuracy) ||
                                accuracy < bestAccuracy
                            )
                        )
                    ) {
                        bestPosition = position;
                    }

                    if (aiLocationStatus && Number.isFinite(accuracy)) {
                        const accuracyLabel = accuracy >= 1000
                            ? `${(accuracy / 1000).toFixed(1)} km`
                            : `${Math.round(accuracy)} m`;

                        aiLocationStatus.innerText =
                            `Improving location accuracy… current estimate: ${accuracyLabel}.`;
                        aiLocationStatus.style.color = '#475569';
                    }

                    if (
                        Number.isFinite(accuracy) &&
                        accuracy <= GOOD_LOCATION_ACCURACY_METERS
                    ) {
                        bestPosition = position;
                        acceptBestPosition();
                    }
                },
                error => {
                    if (bestPosition) {
                        acceptBestPosition();
                        return;
                    }

                    const message =
                        error.code === 1
                            ? 'Location access was not enabled. Click your preferred point on the map instead.'
                            : `Your location could not be retrieved: ${error.message}. Click your preferred point on the map instead.`;

                    finish(false, message);
                },
                {
                    enableHighAccuracy: true,
                    timeout: LOCATION_SAMPLE_WINDOW_MS,
                    maximumAge: 0
                }
            );
        }).finally(() => {
            if (useCurrentLocationBtn) {
                useCurrentLocationBtn.disabled = false;
                useCurrentLocationBtn.innerHTML = originalText;
            }

            preferredLocationRequestPromise = null;
        });

        return preferredLocationRequestPromise;
    }

    function useCurrentPositionForPreferences() {
        return requestCurrentPositionForPreferences({ automatic: false });
    }

    async function requestLocationOnFirstTenantVisit(userId) {
        const currentPreferences = getAiPreferences();
        const alreadyHasCoordinates =
            Number.isFinite(currentPreferences.latitude) &&
            Number.isFinite(currentPreferences.longitude);

        if (
            !userId ||
            alreadyHasCoordinates ||
            sessionStorage.getItem(LOCATION_PROMPT_SESSION_KEY) === 'yes'
        ) {
            return false;
        }

        sessionStorage.setItem(LOCATION_PROMPT_SESSION_KEY, 'yes');

        if (navigator.permissions?.query) {
            try {
                const permission = await navigator.permissions.query({
                    name: 'geolocation'
                });

                if (permission.state === 'denied') {
                    if (aiLocationStatus) {
                        aiLocationStatus.innerText =
                            'Location permission is blocked. Enable it in your browser settings or click the map.';
                        aiLocationStatus.style.color = '#b45309';
                    }

                    return false;
                }
            } catch {
                // Some browsers expose Permissions API without geolocation support.
            }
        }

        const locationSelected =
            await requestCurrentPositionForPreferences({ automatic: true });

        if (!locationSelected) return false;

        try {
            await saveAiPreferences(userId, getAiPreferences());
        } catch (error) {
            console.warn(
                'Location selected but could not be saved:',
                error.message
            );
        }

        return true;
    }

    function getPrimaryStoredLocation(preferredLocations) {
        if (Array.isArray(preferredLocations)) {
            return preferredLocations.find(item => item?.is_primary) || preferredLocations[0] || null;
        }

        if (preferredLocations && typeof preferredLocations === 'object') {
            if (Object.prototype.hasOwnProperty.call(preferredLocations, 'primary')) {
                return preferredLocations.primary;
            }

            return preferredLocations;
        }

        return null;
    }

    async function loadStoredAiPreferences(userId) {
        if (!userId || aiPreferencesLoadedForUser === userId) {
            initializePreferredLocationMap(
                aiLatitudeInput?.value || null,
                aiLongitudeInput?.value || null
            );
            return;
        }

        const { data, error } = await supabaseClient
            .from('user_preferences')
            .select('id, preferred_locations, max_budget_ghs')
            .eq('tenant_id', userId)
            .order('last_updated', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.warn('Unable to load saved AI preferences:', error.message);
            initializePreferredLocationMap();
            aiPreferencesLoadedForUser = userId;
            return;
        }

        const storedLocation = getPrimaryStoredLocation(data?.preferred_locations);
        const storedProfile = (
            data?.preferred_locations &&
            !Array.isArray(data.preferred_locations) &&
            typeof data.preferred_locations === 'object'
        )
            ? data.preferred_locations
            : {};

        if (storedLocation) {
            if (aiLocationInput && storedLocation.label) {
                aiLocationInput.value = storedLocation.label;
            }

            if (aiRadiusInput && storedLocation.radius_km) {
                aiRadiusInput.value = String(storedLocation.radius_km);
            }
        }

        if (aiBudgetInput && data?.max_budget_ghs) {
            aiBudgetInput.value = String(data.max_budget_ghs);
        }

        if (aiTypeInput && storedProfile.property_type) {
            aiTypeInput.value = storedProfile.property_type;
        }

        if (aiBedroomsInput && storedProfile.bedrooms !== null && storedProfile.bedrooms !== undefined) {
            aiBedroomsInput.value = String(storedProfile.bedrooms);
        }

        initializePreferredLocationMap(
            storedLocation?.latitude ?? storedLocation?.lat ?? null,
            storedLocation?.longitude ?? storedLocation?.lng ?? null
        );

        aiPreferencesLoadedForUser = userId;
    }

    async function saveAiPreferences(userId, preferences) {
        if (!userId) return;

        const hasCoordinates =
            Number.isFinite(preferences.latitude) &&
            Number.isFinite(preferences.longitude);

        const primaryLocation = (
            preferences.location ||
            hasCoordinates
        )
            ? {
                label: preferences.location || 'Selected map point',
                latitude: hasCoordinates ? preferences.latitude : null,
                longitude: hasCoordinates ? preferences.longitude : null,
                radius_km: preferences.radiusKm,
                is_primary: true
            }
            : null;

        const preferredLocations = {
            primary: primaryLocation,
            property_type: preferences.type,
            bedrooms: preferences.bedrooms
        };

        const preferencePayload = {
            tenant_id: userId,
            preferred_locations: preferredLocations,
            max_budget_ghs: preferences.budget,
            last_updated: new Date().toISOString()
        };

        const { data: existing, error: lookupError } = await supabaseClient
            .from('user_preferences')
            .select('id')
            .eq('tenant_id', userId)
            .order('last_updated', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lookupError) throw lookupError;

        if (existing?.id) {
            const { error: updateError } = await supabaseClient
                .from('user_preferences')
                .update(preferencePayload)
                .eq('id', existing.id)
                .eq('tenant_id', userId);

            if (updateError) throw updateError;
            return;
        }

        const preferenceId = window.crypto?.randomUUID
            ? window.crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
                const randomValue = Math.floor(Math.random() * 16);
                const uuidValue = character === 'x'
                    ? randomValue
                    : (randomValue & 0x3) | 0x8;

                return uuidValue.toString(16);
            });

        const { error: insertError } = await supabaseClient
            .from('user_preferences')
            .insert([{
                id: preferenceId,
                ...preferencePayload
            }]);

        if (insertError) throw insertError;
    }

    function getAiPreferences() {
        const latitudeValue = aiLatitudeInput?.value;
        const longitudeValue = aiLongitudeInput?.value;

        return {
            location: aiLocationInput ? aiLocationInput.value.trim() : '',
            type: aiTypeInput ? aiTypeInput.value : 'all',
            budget: aiBudgetInput && aiBudgetInput.value ? Number(aiBudgetInput.value) : null,
            bedrooms: aiBedroomsInput && aiBedroomsInput.value ? Number(aiBedroomsInput.value) : null,
            latitude: latitudeValue !== undefined && latitudeValue !== ''
                ? Number(latitudeValue)
                : null,
            longitude: longitudeValue !== undefined && longitudeValue !== ''
                ? Number(longitudeValue)
                : null,
            radiusKm: aiRadiusInput?.value ? Number(aiRadiusInput.value) : 5
        };
    }

    function normalizeRecommendationRow(row) {
        const reasons = Array.isArray(row.match_reasons)
            ? row.match_reasons.filter(Boolean)
            : [];

        return {
            id: row.property_id,
            landlord_id: row.landlord_id,
            title: row.title,
            location: row.location,
            price_ghs: row.price_ghs,
            description: row.description,
            amenities: row.amenities || {},
            status: row.status,
            images: Array.isArray(row.images) ? row.images : [],
            type: row.property_type,
            bedrooms: row.bedrooms,
            bathrooms: row.bathrooms,
            gps_latitude: row.gps_latitude,
            gps_longitude: row.gps_longitude,
            distanceKm:
                row.distance_km === null || row.distance_km === undefined
                    ? null
                    : Number(row.distance_km),
            aiScore: Number(row.match_score || 0),
            aiReasons:
                reasons.length > 0
                    ? reasons
                    : ['available listing'],
            aiLabel: row.match_label || 'Recommended',
            primaryImageUrl: row.primary_image_url || null
        };
    }

    async function loadSmartRecommendations(options = {}) {
        if (!smartRecommendationsGrid) return;

        const requestSequence = ++smartRecommendationRequestSequence;
        const isCurrentRequest = () =>
            requestSequence === smartRecommendationRequestSequence;

        smartRecommendationsGrid.innerHTML = `
            <div style="text-align: center; grid-column: 1 / -1; padding: 40px; color: #64748b;">
                <i class="ph ph-spinner ph-spin" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>Generating smart recommendations from your real data...</p>
            </div>
        `;

        const user = await getAuthenticatedUser();

        if (!user) {
            if (isCurrentRequest()) {
                smartRecommendationsGrid.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <i class="ph ph-lock"></i>
                        <h3>Login Required</h3>
                        <p>Please log in as a tenant to use Smart AI Match.</p>
                    </div>
                `;
            }
            return;
        }

        await loadStoredAiPreferences(user.id);

        if (options.requestLocation === true) {
            await requestLocationOnFirstTenantVisit(user.id);
        }

        if (!isCurrentRequest()) return;

        const preferences = getAiPreferences();

        if (options.persistPreferences === true) {
            try {
                await saveAiPreferences(user.id, preferences);
            } catch (preferenceError) {
                console.warn('Unable to save AI preferences:', preferenceError.message);
                alert(`Your matches can still be generated, but the preferences could not be saved: ${preferenceError.message}`);
            }
        }

        try {
            const { data, error } = await supabaseClient.rpc(
                'get_ai_property_recommendations',
                {
                    p_tenant_latitude:
                        Number.isFinite(preferences.latitude)
                            ? preferences.latitude
                            : null,
                    p_tenant_longitude:
                        Number.isFinite(preferences.longitude)
                            ? preferences.longitude
                            : null,
                    p_radius_km: preferences.radiusKm,
                    p_location_text: preferences.location || null,
                    p_property_type:
                        preferences.type && preferences.type !== 'all'
                            ? preferences.type
                            : null,
                    p_max_budget: preferences.budget,
                    p_bedrooms:
                        Number.isFinite(preferences.bedrooms)
                            ? preferences.bedrooms
                            : null,
                    p_max_results: 12
                }
            );

            if (error) throw error;
            if (!isCurrentRequest()) return;

            const recommendations =
                (data || []).map(normalizeRecommendationRow);

            renderSmartRecommendations(recommendations, preferences);

            if (options.persistPreferences === true) {
                if (preferences.location) {
                    recordTenantActivity({
                        activity_type: 'search_location',
                        search_location: preferences.location
                    });
                }

                if (preferences.type && preferences.type !== 'all') {
                    recordTenantActivity({
                        activity_type: 'filter_type',
                        property_type: preferences.type
                    });
                }

                if (preferences.budget) {
                    recordTenantActivity({
                        activity_type: 'filter_budget',
                        budget: preferences.budget
                    });
                }
            }

            await loadTenantNotifications();
        } catch (error) {
            console.error('Smart recommendation error:', error);

            if (!isCurrentRequest()) return;

            smartRecommendationsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-warning"></i>
                    <h3>Smart Match Failed</h3>
                    <p>${error.message || 'Unable to generate recommendations at this time.'}</p>
                </div>
            `;
        }
    }

    async function runSmartRecommendationAction(
        triggerButton,
        options,
        loadingLabel
    ) {
        const originalMarkup = triggerButton?.innerHTML || '';

        if (triggerButton) {
            triggerButton.disabled = true;
            triggerButton.innerHTML =
                `<i class="ph ph-spinner ph-spin"></i> ${loadingLabel}`;
        }

        try {
            await loadSmartRecommendations(options);
        } finally {
            if (triggerButton) {
                triggerButton.disabled = false;
                triggerButton.innerHTML = originalMarkup;
            }
        }
    }

    function renderSmartRecommendations(recommendations, preferences) {
        if (!smartRecommendationsGrid) return;

        if (!recommendations || recommendations.length === 0) {
            const hasCoordinates =
                Number.isFinite(preferences.latitude) &&
                Number.isFinite(preferences.longitude);

            smartRecommendationsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-magnifying-glass"></i>
                    <h3>No Smart Matches Found</h3>
                    <p>
                        ${
                            hasCoordinates
                                ? `No available pinned property matched within ${preferences.radiusKm} km. Increase the distance or change a preference.`
                                : 'Enable location, click a point on the map, increase your budget, or change a preference.'
                        }
                    </p>
                </div>
            `;

            if (aiSummaryCard && aiSummaryText) {
                aiSummaryCard.style.display = 'block';
                aiSummaryText.innerText =
                    'No available properties matched the current preference combination.';
            }

            return;
        }

        const distanceMatches = recommendations.filter(
            property => Number.isFinite(property.distanceKm)
        );
        const nearestDistance =
            distanceMatches.length > 0
                ? Math.min(
                    ...distanceMatches.map(property => property.distanceKm)
                )
                : null;

        if (aiSummaryCard && aiSummaryText) {
            aiSummaryCard.style.display = 'block';

            if (nearestDistance !== null) {
                aiSummaryText.innerText =
                    `Found ${recommendations.length} top available match(es) within ${preferences.radiusKm} km. ` +
                    `The nearest is ${nearestDistance.toFixed(1)} km away. ` +
                    'Scores combine real distance, budget, property type, bedrooms, saved spaces, searches, and offer activity.';
            } else {
                aiSummaryText.innerText =
                    `Found ${recommendations.length} top available match(es) using typed-location fallback. ` +
                    'For exact nearest-property results, enable location or select a point on the map and ensure landlords pin their listings.';
            }
        }

        smartRecommendationsGrid.innerHTML = recommendations.map(property => {
            let imageUrl =
                'https://via.placeholder.com/400x250?text=No+Image+Available';

            if (property.primaryImageUrl) {
                imageUrl = property.primaryImageUrl;
            } else if (Array.isArray(property.images) && property.images.length > 0) {
                imageUrl = property.images[0];
            }

            const amenities = property.amenities || {};
            const beds = property.bedrooms ?? amenities.beds ?? '-';
            const baths = property.bathrooms ?? amenities.baths ?? '-';
            const propType = property.type || amenities.type || 'Listing Asset';

            const price = Number(property.price_ghs || 0).toLocaleString('en-GH', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            });

            const reasonsText = property.aiReasons
                .filter(reason => !/\bkm away$/i.test(reason))
                .slice(0, 3)
                .map(reason => reason.replace(/\b\w/g, char => char.toUpperCase()))
                .join(' • ') || 'Distance-Based Location Match';

            const distanceMarkup =
                Number.isFinite(property.distanceKm)
                    ? `
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; color:#047857; font-size:0.88rem; font-weight:600;">
                            <span style="display:flex; align-items:center; gap:5px;">
                                <i class="ph ph-navigation-arrow"></i>
                                ${property.distanceKm.toFixed(1)} km away
                            </span>
                            <span style="color:#64748b; font-weight:500;">
                                Within ${preferences.radiusKm} km radius
                            </span>
                        </div>
                    `
                    : `
                        <div style="display:flex; align-items:center; gap:5px; margin-bottom:12px; color:#b45309; font-size:0.84rem; font-weight:600;">
                            <i class="ph ph-map-pin-line"></i>
                            Text-location fallback
                        </div>
                    `;

            return `
                <div class="property-card" data-id="${property.id}" style="cursor: pointer;">
                    <div class="image-container">
                        <img src="${imageUrl}" alt="${property.title || 'Recommended Property'}" loading="lazy">

                        <div class="badge-verified" style="color: #7c3aed;">
                            <i class="ph ph-sparkle"></i> ${property.aiLabel}
                        </div>
                    </div>

                    <div class="card-content">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <div class="property-type">${propType}</div>
                            <span class="status-badge status-accepted">${property.aiScore}% Match</span>
                        </div>

                        <h3 style="margin: 8px 0; font-size: 1.15rem; font-weight: 600;">
                            ${property.title || 'Untitled Property'}
                        </h3>

                        <div class="location" style="display: flex; align-items: center; gap: 4px; color: #64748b; margin-bottom: 12px;">
                            <i class="ph ph-map-pin"></i> ${property.location || 'Location Unspecified'}
                        </div>

                        ${distanceMarkup}

                        <div class="features-summary" style="display: flex; gap: 16px; color: #64748b; font-size: 0.9rem; margin-bottom: 12px;">
                            <span style="display: flex; align-items: center; gap: 6px;">
                                <i class="ph ph-bed"></i> ${beds} Bed
                            </span>

                            <span style="display: flex; align-items: center; gap: 6px;">
                                <i class="ph ph-bathtub"></i> ${baths} Bath
                            </span>
                        </div>

                        <p style="font-size: 0.82rem; color: #7c3aed; margin: 0 0 12px 0; font-weight: 600;">
                            ${reasonsText}
                        </p>

                        <div class="price-container" style="display: flex; align-items: baseline; gap: 4px;">
                            <div class="price" style="font-size: 1.25rem; font-weight: 700; color: #0d8abc;">
                                GHS ${price}
                            </div>
                            <span class="price-period" style="color: #64748b; font-size: 0.9rem;">/ month</span>
                        </div>

                        <div style="display: flex; gap: 8px; margin-top: 16px;">
                            <button
                                class="btn-primary ai-view-property-btn"
                                data-id="${property.id}"
                                style="flex: 1;"
                            >
                                View Details
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    document.addEventListener('click', (e) => {
        const aiViewBtn = e.target.closest('.ai-view-property-btn');
        const aiCard = e.target.closest('#smart-recommendations-grid .property-card');

        if (aiViewBtn) {
            e.stopPropagation();

            const propertyId = aiViewBtn.getAttribute('data-id');

            recordTenantActivity({
                activity_type: 'view_property',
                property_id: propertyId
            });

            window.location.href = `property-details.html?id=${propertyId}`;
            return;
        }

        if (aiCard) {
            const propertyId = aiCard.getAttribute('data-id');

            if (propertyId) {
                recordTenantActivity({
                    activity_type: 'view_property',
                    property_id: propertyId
                });

                window.location.href = `property-details.html?id=${propertyId}`;
            }
        }
    });

    useCurrentLocationBtn?.addEventListener('click', async (event) => {
        event.preventDefault();

        const locationSelected = await useCurrentPositionForPreferences();

        if (locationSelected) {
            await runSmartRecommendationAction(
                useCurrentLocationBtn,
                { persistPreferences: true },
                'Generating...'
            );
        }
    });

    generateAiMatchBtn?.addEventListener('click', async (event) => {
        event.preventDefault();

        await runSmartRecommendationAction(
            generateAiMatchBtn,
            { persistPreferences: true },
            'Generating Matches...'
        );
    });

    refreshRecommendationsBtn?.addEventListener('click', async (event) => {
        event.preventDefault();

        await runSmartRecommendationAction(
            refreshRecommendationsBtn,
            { persistPreferences: false },
            'Refreshing...'
        );
    });

    window.loadSmartRecommendations = loadSmartRecommendations;
    window.loadTenantNotifications = loadTenantNotifications;
    window.loadTenantLeases = loadTenantLeases;
    window.loadNegotiations = loadNegotiations;

    // ==========================================
    // INITIAL LOAD
    // ==========================================
    async function initializeTenantDashboard() {
        try {
            const user = await getAuthenticatedUser({
                redirectIfMissing: true
            });

            if (!user) return;

            await loadUserProfile(user);

            await Promise.allSettled([
                loadNegotiations(),
                loadTenantLeases(),
                loadTenantPayments(),
                loadSavedProperties(),
                loadTenantNotifications()
            ]);

            if (typeof loadSmartRecommendations === 'function') {
                await loadSmartRecommendations({
                    requestLocation: true
                });
            }
        } catch (error) {
            console.error(
                'Unable to initialize the tenant dashboard:',
                error
            );

            alert(
                'Your login session could not be verified. Please log in again.'
            );

            redirectToLogin();
        }
    }

    initializeTenantDashboard();
});
