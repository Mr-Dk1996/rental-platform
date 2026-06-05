document.addEventListener('DOMContentLoaded', () => {
    // ==========================================
    // GLOBAL STATE
    // ==========================================
    let activeNegotiationId = null;
let currentUser = null;
let activeChatChannel = null;

let tenantActivityTimer = null;
let browsePersonalizationTimer = null;
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

        if (sectionId === 'negotiations' && typeof loadNegotiations === 'function') {
            loadNegotiations();
        }

        if (sectionId === 'recommendations' && typeof loadSmartRecommendations === 'function') {
            loadSmartRecommendations();
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

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await performLogout(logoutBtn);
        });
    }

    if (profileMenuLogout) {
        profileMenuLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            await performLogout(profileMenuLogout);
        });
    }

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

    async function loadUserProfile() {
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            console.error('No valid user session found.');
            return;
        }

        currentUser = user;

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

                const encodedName = encodeURIComponent(fullName);
                const fallbackAvatarUrl = `https://ui-avatars.com/api/?name=${encodedName}&background=0D8ABC&color=fff&size=80`;
                const avatarUrl = profile.profile_photo_url || fallbackAvatarUrl;

                if (displayAvatar) displayAvatar.src = avatarUrl;
                if (topbarAvatar) topbarAvatar.src = avatarUrl;
            }
        } catch (err) {
            console.error('Error loading profile:', err.message);
        }
    }

    loadUserProfile();
    bindProfileMenu();

    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
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
    }

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

    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

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
    }

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
                budget: budget
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

            const cardText = propertyCard?.innerText || '';
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
        label.innerHTML = `<i class="ph ph-sparkle"></i> Recommended for you`;

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
                .eq('status', 'Accepted')
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
                .eq('status', 'Accepted')
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
    // 9. FREE AI-ASSISTED SMART RECOMMENDATIONS
    // ==========================================
    const smartRecommendationsGrid = document.getElementById('smart-recommendations-grid');
    const aiLocationInput = document.getElementById('ai-location');
    const aiTypeInput = document.getElementById('ai-type');
    const aiBudgetInput = document.getElementById('ai-budget');
    const aiBedroomsInput = document.getElementById('ai-bedrooms');
    const generateAiMatchBtn = document.getElementById('generate-ai-match-btn');
    const refreshRecommendationsBtn = document.getElementById('refresh-recommendations-btn');
    const aiSummaryCard = document.getElementById('ai-summary-card');
    const aiSummaryText = document.getElementById('ai-summary-text');

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function tokenize(value) {
        return normalizeText(value)
            .split(' ')
            .filter(word => word.length > 1);
    }

    function levenshteinDistance(a, b) {
        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    function fuzzyIncludes(source, search) {
        const cleanSource = normalizeText(source);
        const cleanSearch = normalizeText(search);

        if (!cleanSearch) return true;
        if (cleanSource.includes(cleanSearch)) return true;

        const sourceTokens = tokenize(cleanSource);
        const searchTokens = tokenize(cleanSearch);

        return searchTokens.some(searchWord => {
            return sourceTokens.some(sourceWord => {
                return sourceWord.includes(searchWord) ||
                    searchWord.includes(sourceWord) ||
                    levenshteinDistance(sourceWord, searchWord) <= 2;
            });
        });
    }

    function getAiPreferences() {
        return {
            location: aiLocationInput ? aiLocationInput.value.trim() : '',
            type: aiTypeInput ? aiTypeInput.value : 'all',
            budget: aiBudgetInput && aiBudgetInput.value ? Number(aiBudgetInput.value) : null,
            bedrooms: aiBedroomsInput && aiBedroomsInput.value ? Number(aiBedroomsInput.value) : null
        };
    }

    function calculatePropertyMatchScore(property, preferences, userSignals) {
        let score = 0;
        const reasons = [];

        const amenities = property.amenities || {};
        const propertyType = property.type || amenities.type || '';
        const propertyLocation = property.location || '';
        const propertyTitle = property.title || '';
        const propertyPrice = Number(property.price_ghs || 0);
        const propertyBedrooms = Number(property.bedrooms ?? amenities.beds ?? 0);

        if (preferences.location) {
            if (fuzzyIncludes(propertyLocation, preferences.location) || fuzzyIncludes(propertyTitle, preferences.location)) {
                score += 30;
                reasons.push('location match');
            }
        }

        if (preferences.type && preferences.type !== 'all') {
            if (propertyType === preferences.type) {
                score += 25;
                reasons.push('preferred property type');
            }
        }

        if (preferences.budget && propertyPrice > 0) {
            if (propertyPrice <= preferences.budget) {
                score += 25;
                reasons.push('within budget');
            } else {
                const difference = propertyPrice - preferences.budget;
                const tolerance = preferences.budget * 0.15;

                if (difference <= tolerance) {
                    score += 10;
                    reasons.push('slightly above budget');
                }
            }
        }

        if (preferences.bedrooms !== null && !Number.isNaN(preferences.bedrooms)) {
            if (propertyBedrooms === preferences.bedrooms) {
                score += 15;
                reasons.push('bedroom preference match');
            } else if (Math.abs(propertyBedrooms - preferences.bedrooms) === 1) {
                score += 5;
                reasons.push('close bedroom match');
            }
        }

        if (userSignals.savedTypes.has(propertyType)) {
            score += 12;
            reasons.push('similar to saved spaces');
        }

        if (Array.from(userSignals.savedLocations).some(loc => fuzzyIncludes(propertyLocation, loc))) {
            score += 12;
            reasons.push('similar saved location');
        }

        if (userSignals.negotiatedTypes.has(propertyType)) {
            score += 10;
            reasons.push('matches negotiation history');
        }

        if (Array.from(userSignals.negotiatedLocations).some(loc => fuzzyIncludes(propertyLocation, loc))) {
            score += 10;
            reasons.push('matches previous search interest');
        }

        if (!preferences.budget && userSignals.averageSavedBudget > 0 && propertyPrice > 0) {
            if (propertyPrice <= userSignals.averageSavedBudget) {
                score += 8;
                reasons.push('budget friendly based on saved spaces');
            }
        }

        if (property.status === 'Available') {
            score += 5;
        }

        if (reasons.length === 0) {
            reasons.push('available listing');
        }

        return {
            score: Math.min(score, 100),
            reasons
        };
    }

    function getRecommendationLabel(score, reasons) {
        if (score >= 75) return 'Best Match';
        if (reasons.includes('within budget')) return 'Budget Friendly';
        if (reasons.includes('similar to saved spaces')) return 'Similar to Saved';
        if (reasons.includes('location match')) return 'Location Match';
        if (score >= 45) return 'Good Match';

        return 'Recommended';
    }

    async function loadSmartRecommendations() {
        if (!smartRecommendationsGrid) return;

        smartRecommendationsGrid.innerHTML = `
            <div style="text-align: center; grid-column: 1 / -1; padding: 40px; color: #64748b;">
                <i class="ph ph-spinner ph-spin" style="font-size: 2rem; margin-bottom: 10px;"></i>
                <p>Generating smart recommendations from your real data...</p>
            </div>
        `;

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !user) {
            smartRecommendationsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-lock"></i>
                    <h3>Login Required</h3>
                    <p>Please log in as a tenant to use Smart AI Match.</p>
                </div>
            `;
            return;
        }

        const preferences = getAiPreferences();

        try {
            const { data: properties, error: propertiesError } = await supabaseClient
                .from('properties')
                .select('*, property_images(storage_path)')
                .eq('status', 'Available')
                .order('created_at', { ascending: false });

            if (propertiesError) throw propertiesError;

            const { data: savedItems, error: savedError } = await supabaseClient
                .from('saved_properties')
                .select(`
                    property_id,
                    properties (
                        id,
                        title,
                        location,
                        price_ghs,
                        type,
                        bedrooms,
                        bathrooms,
                        amenities
                    )
                `)
                .eq('user_id', user.id);

            if (savedError) throw savedError;

            const { data: negotiations, error: negotiationsError } = await supabaseClient
                .from('negotiations')
                .select(`
                    id,
                    offer_amount,
                    status,
                    properties (
                        id,
                        title,
                        location,
                        price_ghs,
                        type,
                        bedrooms,
                        bathrooms,
                        amenities
                    )
                `)
                .eq('tenant_id', user.id);

            if (negotiationsError) throw negotiationsError;

            const userSignals = {
                savedTypes: new Set(),
                savedLocations: new Set(),
                negotiatedTypes: new Set(),
                negotiatedLocations: new Set(),
                averageSavedBudget: 0
            };

            let savedBudgetTotal = 0;
            let savedBudgetCount = 0;

            (savedItems || []).forEach(item => {
                const property = item.properties;
                if (!property) return;

                const amenities = property.amenities || {};
                const type = property.type || amenities.type;
                const location = property.location;
                const price = Number(property.price_ghs || 0);

                if (type) userSignals.savedTypes.add(type);
                if (location) userSignals.savedLocations.add(location);

                if (price > 0) {
                    savedBudgetTotal += price;
                    savedBudgetCount++;
                }
            });

            if (savedBudgetCount > 0) {
                userSignals.averageSavedBudget = savedBudgetTotal / savedBudgetCount;
            }

            (negotiations || []).forEach(item => {
                const property = item.properties;
                if (!property) return;

                const amenities = property.amenities || {};
                const type = property.type || amenities.type;
                const location = property.location;

                if (type) userSignals.negotiatedTypes.add(type);
                if (location) userSignals.negotiatedLocations.add(location);
            });

            let scoredProperties = (properties || []).map(property => {
                const match = calculatePropertyMatchScore(property, preferences, userSignals);

                return {
                    ...property,
                    aiScore: match.score,
                    aiReasons: match.reasons,
                    aiLabel: getRecommendationLabel(match.score, match.reasons)
                };
            });

            const hasStrongPreference =
                preferences.location ||
                (preferences.type && preferences.type !== 'all') ||
                preferences.budget ||
                preferences.bedrooms !== null;

            if (hasStrongPreference) {
                scoredProperties = scoredProperties.filter(property => property.aiScore >= 15);
            }

            scoredProperties.sort((a, b) => b.aiScore - a.aiScore);

            const topRecommendations = scoredProperties.slice(0, 12);

            renderSmartRecommendations(topRecommendations, userSignals);
            await loadTenantNotifications();
        } catch (error) {
            console.error('Smart recommendation error:', error);

            smartRecommendationsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-warning"></i>
                    <h3>Smart Match Failed</h3>
                    <p>${error.message || 'Unable to generate recommendations at this time.'}</p>
                </div>
            `;
        }
    }

    function renderSmartRecommendations(recommendations, userSignals) {
        if (!smartRecommendationsGrid) return;

        if (!recommendations || recommendations.length === 0) {
            smartRecommendationsGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i class="ph ph-magnifying-glass"></i>
                    <h3>No Smart Matches Found</h3>
                    <p>Try increasing your budget, changing the location, or selecting Any Property Type.</p>
                </div>
            `;

            if (aiSummaryCard && aiSummaryText) {
                aiSummaryCard.style.display = 'block';
                aiSummaryText.innerText = 'No available properties matched the current preference combination.';
            }

            return;
        }

        const savedSignalsCount = userSignals.savedTypes.size + userSignals.savedLocations.size;
        const negotiationSignalsCount = userSignals.negotiatedTypes.size + userSignals.negotiatedLocations.size;

        if (aiSummaryCard && aiSummaryText) {
            aiSummaryCard.style.display = 'block';

            aiSummaryText.innerText =
                `The system analyzed ${recommendations.length} top available listing(s) using your selected preferences` +
                `${savedSignalsCount > 0 ? ', saved spaces' : ''}` +
                `${negotiationSignalsCount > 0 ? ', and negotiation history' : ''}. ` +
                `Higher scores mean the property is closer to your preferred location, type, budget, and previous activity.`;
        }

        smartRecommendationsGrid.innerHTML = recommendations.map(property => {
            let imageUrl = 'https://via.placeholder.com/400x250?text=No+Image+Available';

            if (property.property_images && property.property_images.length > 0) {
                imageUrl = property.property_images[0].storage_path;
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
                .slice(0, 3)
                .map(reason => reason.replace(/\b\w/g, char => char.toUpperCase()))
                .join(' • ');

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
                window.location.href = `property-details.html?id=${propertyId}`;
            }
        }
    });

    if (generateAiMatchBtn) {
        generateAiMatchBtn.addEventListener('click', loadSmartRecommendations);
    }

    if (refreshRecommendationsBtn) {
        refreshRecommendationsBtn.addEventListener('click', loadSmartRecommendations);
    }

    window.loadSmartRecommendations = loadSmartRecommendations;
    window.loadTenantNotifications = loadTenantNotifications;

    // ==========================================
    // INITIAL LOAD
    // ==========================================
    loadNegotiations();
    loadTenantLeases();
    loadSavedProperties();
    loadTenantNotifications();

    if (typeof loadSmartRecommendations === 'function') {
        loadSmartRecommendations();
    }
});