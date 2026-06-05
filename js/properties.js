document.addEventListener('DOMContentLoaded', () => {
    const gridContainer = document.getElementById('properties-grid');
    const loadMoreContainer = document.getElementById('load-more-container');
    const loadMoreBtn = document.getElementById('load-more-btn');

    const searchInput = document.getElementById('search-input');
    const filterType = document.getElementById('filter-type');
    const filterPrice = document.getElementById('filter-price');

    const itemsPerPage = 10;

    let currentPage = 0;
    let isFetching = false;
    let totalItems = 0;
    let savedPropertyIds = new Set();
    let searchTimer = null;
    let activityTimer = null;

    function escapeSupabaseOrValue(value) {
        return String(value || '')
            .replace(/[%]/g, '\\%')
            .replace(/[_]/g, '\\_')
            .replace(/,/g, '\\,')
            .trim();
    }

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function fuzzyIncludes(source, search) {
        const cleanSource = normalizeText(source);
        const cleanSearch = normalizeText(search);

        if (!cleanSearch) return true;
        if (cleanSource.includes(cleanSearch)) return true;

        const sourceWords = cleanSource.split(' ').filter(word => word.length > 2);
        const searchWords = cleanSearch.split(' ').filter(word => word.length > 2);

        return searchWords.some(searchWord => {
            return sourceWords.some(sourceWord => {
                return sourceWord.includes(searchWord) || searchWord.includes(sourceWord);
            });
        });
    }

    function getBudgetFromPriceFilter(value) {
        if (value === 'low') return 1000;
        if (value === 'mid') return 3000;
        if (value === 'high') return 5000;
        return null;
    }

    function getCurrentFilters() {
        return {
            search: searchInput ? searchInput.value.trim() : '',
            type: filterType ? filterType.value : 'all',
            price: filterPrice ? filterPrice.value : 'all'
        };
    }

    async function recordTenantActivity(activity) {
        try {
            if (typeof window.recordTenantActivity === 'function') {
                window.recordTenantActivity(activity);
                return;
            }

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

    function debounceActivity(callback, delay = 700) {
        clearTimeout(activityTimer);
        activityTimer = setTimeout(callback, delay);
    }

    async function loadUserSavedPropertiesState() {
        try {
            const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

            if (authError || !user) {
                savedPropertyIds = new Set();
                return;
            }

            const { data, error } = await supabaseClient
                .from('saved_properties')
                .select('property_id')
                .eq('user_id', user.id);

            if (error) throw error;

            savedPropertyIds = new Set((data || []).map(item => item.property_id));
        } catch (err) {
            console.warn('Unable to load saved property state:', err.message);
            savedPropertyIds = new Set();
        }
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

            const { data: activities, error: activityError } = await supabaseClient
                .from('tenant_activity')
                .select('*')
                .eq('tenant_id', user.id)
                .order('created_at', { ascending: false })
                .limit(80);

            if (activityError) throw activityError;

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

    function hasPersonalizationSignals(signals) {
        return (
            signals.searchedLocations.size > 0 ||
            signals.filteredTypes.size > 0 ||
            signals.viewedPropertyIds.size > 0 ||
            signals.savedPropertyIds.size > 0 ||
            signals.negotiatedPropertyIds.size > 0 ||
            signals.budgets.length > 0
        );
    }

    function scorePropertyForTenant(property, signals) {
        let score = 0;
        const reasons = [];

        const amenities = property.amenities || {};
        const propertyId = property.id;
        const propertyType = normalizeText(property.type || amenities.type || '');
        const propertyLocation = normalizeText(property.location || '');
        const propertyTitle = normalizeText(property.title || '');
        const searchableText = `${propertyTitle} ${propertyLocation} ${propertyType}`;
        const propertyPrice = Number(property.price_ghs || 0);

        if (propertyId && signals.savedPropertyIds.has(propertyId)) {
            score += 45;
            reasons.push('Saved by you');
        }

        if (propertyId && signals.negotiatedPropertyIds.has(propertyId)) {
            score += 40;
            reasons.push('You sent an offer before');
        }

        if (propertyId && signals.viewedPropertyIds.has(propertyId)) {
            score += 22;
            reasons.push('Viewed before');
        }

        signals.filteredTypes.forEach(type => {
            if (type && (propertyType.includes(type) || type.includes(propertyType))) {
                score += 28;
                reasons.push('Matches your room type');
            }
        });

        signals.searchedLocations.forEach(location => {
            if (!location) return;

            if (
                fuzzyIncludes(propertyLocation, location) ||
                fuzzyIncludes(propertyTitle, location) ||
                fuzzyIncludes(searchableText, location)
            ) {
                score += 28;
                reasons.push('Matches your recent location search');
            }
        });

        if (signals.budgets.length > 0 && propertyPrice > 0) {
            const highestBudget = Math.max(...signals.budgets);

            if (propertyPrice <= highestBudget) {
                score += 18;
                reasons.push('Within your recent budget');
            } else {
                const tolerance = highestBudget * 0.15;

                if (propertyPrice - highestBudget <= tolerance) {
                    score += 8;
                    reasons.push('Close to your recent budget');
                }
            }
        }

        if (property.status === 'Available') {
            score += 5;
        }

        return {
            score,
            reasons: [...new Set(reasons)]
        };
    }

    function removeDuplicateProperties(properties) {
        const seen = new Set();

        return (properties || []).filter(property => {
            if (!property || !property.id) return false;

            if (seen.has(property.id)) {
                return false;
            }

            seen.add(property.id);
            return true;
        });
    }

    function removeDuplicatePropertyCards() {
        if (!gridContainer) return;

        const seen = new Set();

        gridContainer.querySelectorAll('.property-card[data-id]').forEach(card => {
            const propertyId = card.getAttribute('data-id');

            if (!propertyId) return;

            if (seen.has(propertyId)) {
                card.remove();
            } else {
                seen.add(propertyId);
            }
        });
    }

    function personalizeProperties(properties, signals) {
        const uniqueProperties = removeDuplicateProperties(properties);

        if (!uniqueProperties || uniqueProperties.length === 0) return [];

        if (!hasPersonalizationSignals(signals)) {
            return uniqueProperties.map(property => ({
                ...property,
                personalScore: 0,
                personalReasons: [],
                personalLabel: ''
            }));
        }

        return uniqueProperties
            .map((property, index) => {
                const match = scorePropertyForTenant(property, signals);

                return {
                    ...property,
                    originalIndex: index,
                    personalScore: match.score,
                    personalReasons: match.reasons,
                    personalLabel: match.score >= 55 ? 'Recommended for you' : ''
                };
            })
            .sort((a, b) => {
                if ((b.personalScore || 0) !== (a.personalScore || 0)) {
                    return (b.personalScore || 0) - (a.personalScore || 0);
                }

                return a.originalIndex - b.originalIndex;
            });
    }

    function resetAndFetchProperties() {
        currentPage = 0;
        fetchProperties(0, false);
    }

    async function fetchProperties(page = 0, append = false) {
        if (!gridContainer || isFetching) return;

        isFetching = true;

        if (!append) {
            gridContainer.innerHTML = `
                <div style="text-align: center; grid-column: 1 / -1; padding: 40px; color: #64748b;">
                    <i class="ph ph-spinner ph-spin" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <p>Loading available spaces...</p>
                </div>
            `;
        }

        if (page === 0) {
            await loadUserSavedPropertiesState();
        }

        const startRange = page * itemsPerPage;
        const endRange = startRange + itemsPerPage - 1;

        const filters = getCurrentFilters();

        try {
            let query = supabaseClient
                .from('properties')
                .select('*, property_images(storage_path)', { count: 'exact' })
                .eq('status', 'Available');

            if (filters.search) {
                const searchValue = escapeSupabaseOrValue(filters.search);

                query = query.or(
                    `title.ilike.%${searchValue}%,location.ilike.%${searchValue}%`
                );
            }

            if (filters.type && filters.type !== 'all') {
                query = query.eq('type', filters.type);
            }

            if (filters.price === 'low') {
                query = query.lt('price_ghs', 1000);
            } else if (filters.price === 'mid') {
                query = query.gte('price_ghs', 1000).lte('price_ghs', 3000);
            } else if (filters.price === 'high') {
                query = query.gt('price_ghs', 3000);
            }

            const { data: properties, error, count } = await query
                .order('created_at', { ascending: false })
                .range(startRange, endRange);

            if (error) {
                if (error.message && error.message.includes('JWT expired')) {
                    console.warn('Session expired. Signing out user.');
                    await supabaseClient.auth.signOut();
                    window.location.reload();
                    return;
                }

                throw error;
            }

            totalItems = count || 0;

            let finalProperties = removeDuplicateProperties(properties || []);

            if (page === 0) {
                const signals = await getTenantPersonalizationSignals();
                finalProperties = personalizeProperties(finalProperties, signals);
            }

            renderProperties(finalProperties, append);
            removeDuplicatePropertyCards();

            if (typeof window.personalizeBrowseRoomCards === 'function') {
                setTimeout(() => {
                    window.personalizeBrowseRoomCards();
                    removeDuplicatePropertyCards();
                }, 300);
            }

            if (loadMoreContainer) {
                loadMoreContainer.style.display = endRange + 1 < totalItems ? 'block' : 'none';
            }
        } catch (error) {
            console.error('Unable to load property listings:', error.message);

            if (!append && gridContainer) {
                gridContainer.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                        <p style="color: #ef4444; font-weight: 600;">Unable to load property listings.</p>
                        <p style="color: #94a3b8; font-size: 0.85rem;">${error.message}</p>
                    </div>
                `;
            }
        } finally {
            isFetching = false;
        }
    }

    function renderProperties(properties, append) {
        if (!gridContainer) return;

        if (!append) {
            gridContainer.innerHTML = '';
        }

        if (!properties || properties.length === 0) {
            if (!append) {
                gridContainer.innerHTML = `
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <i class="ph ph-house-line"></i>
                        <h3>No Matching Properties</h3>
                        <p>No available spaces match your current search or filter selection. Try another location, property type, or price range.</p>
                    </div>
                `;
            }

            return;
        }

        const uniqueProperties = removeDuplicateProperties(properties);

        uniqueProperties.forEach(property => {
            if (gridContainer.querySelector(`.property-card[data-id="${property.id}"]`)) {
                return;
            }

            let imageUrl = 'https://via.placeholder.com/400x250?text=No+Image+Available';

            if (property.property_images && property.property_images.length > 0) {
                imageUrl = property.property_images[0].storage_path;
            } else if (Array.isArray(property.images) && property.images.length > 0) {
                imageUrl = property.images[0];
            }

            const amenities = property.amenities || {};
            const beds = property.bedrooms ?? amenities.beds ?? '-';
            const baths = property.bathrooms ?? amenities.baths ?? '-';
            const propType = property.type || amenities.type || 'Property';

            const isSaved = savedPropertyIds.has(property.id);
            const heartIconClass = isSaved ? 'ph-fill' : 'ph';
            const heartColor = isSaved ? '#e53e3e' : 'inherit';

            const price = Number(property.price_ghs || 0).toLocaleString('en-GH', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            });

            const recommendedLabel = property.personalLabel ? `
                <div class="browse-ai-label" style="position: absolute; top: 10px; left: 10px; z-index: 3; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; border-radius: 999px; padding: 6px 10px; font-size: 0.72rem; font-weight: 800; box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);">
                    <i class="ph ph-sparkle"></i> ${property.personalLabel}
                </div>
            ` : '';

            const matchNote = property.personalReasons && property.personalReasons.length > 0 ? `
                <p style="font-size: 0.78rem; color: #047857; margin: 0 0 10px 0; font-weight: 700;">
                    ${property.personalReasons.slice(0, 2).join(' • ')}
                </p>
            ` : '';

            const cardHTML = `
                <div class="property-card" style="cursor: pointer;" data-id="${property.id}">
                    <div class="image-container" style="position: relative;">
                        <img src="${imageUrl}" alt="${property.title || 'Property'}" loading="lazy">
                        ${recommendedLabel}
                    </div>

                    <div class="card-content">
                        <div class="property-type">${propType}</div>

                        <h3 class="property-card-title" style="margin: 8px 0; font-size: 1.15rem; font-weight: 600;">
                            ${property.title || 'Untitled Property'}
                        </h3>

                        <div class="location" style="display: flex; align-items: center; gap: 4px; color: #64748b; margin-bottom: 12px;">
                            <i class="ph ph-map-pin"></i> ${property.location || 'Location not specified'}
                        </div>

                        ${matchNote}

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
                                class="btn-outline save-btn"
                                data-id="${property.id}"
                                data-type="${propType}"
                                data-location="${property.location || ''}"
                                style="padding: 12px; display: flex; align-items: center; justify-content: center; width: 48px; min-width: 48px;"
                                aria-label="Save property"
                            >
                                <i class="${heartIconClass} ph-heart" style="font-size: 1.2rem; color: ${heartColor};"></i>
                            </button>

                            <button
                                class="btn-primary negotiate-btn"
                                data-id="${property.id}"
                                data-type="${propType}"
                                data-location="${property.location || ''}"
                                style="flex: 1;"
                            >
                                View / Send Offer
                            </button>
                        </div>
                    </div>
                </div>
            `;

            gridContainer.insertAdjacentHTML('beforeend', cardHTML);
        });

        removeDuplicatePropertyCards();
    }

    if (gridContainer) {
        gridContainer.addEventListener('click', async (e) => {
            const target = e.target;

            const saveBtn = target.closest('.save-btn');

            if (saveBtn) {
                e.stopPropagation();

                const propertyId = saveBtn.getAttribute('data-id');
                const propertyType = saveBtn.getAttribute('data-type') || null;
                const propertyLocation = saveBtn.getAttribute('data-location') || null;
                const icon = saveBtn.querySelector('i');

                const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

                if (userError || !user) {
                    alert('Please log in to save properties.');
                    return;
                }

                const isCurrentlySaved = icon.classList.contains('ph-fill');

                if (isCurrentlySaved) {
                    icon.classList.remove('ph-fill');
                    icon.classList.add('ph');
                    icon.style.color = 'inherit';
                    savedPropertyIds.delete(propertyId);
                } else {
                    icon.classList.remove('ph');
                    icon.classList.add('ph-fill');
                    icon.style.color = '#e53e3e';
                    savedPropertyIds.add(propertyId);
                }

                try {
                    if (isCurrentlySaved) {
                        const { error } = await supabaseClient
                            .from('saved_properties')
                            .delete()
                            .match({
                                user_id: user.id,
                                property_id: propertyId
                            });

                        if (error) throw error;

                        window.dispatchEvent(new CustomEvent('saved-properties-updated', {
                            detail: {
                                propertyId: propertyId,
                                saved: false
                            }
                        }));
                    } else {
                        const { error } = await supabaseClient
                            .from('saved_properties')
                            .insert([{
                                user_id: user.id,
                                property_id: propertyId
                            }]);

                        if (error) throw error;

                        recordTenantActivity({
                            activity_type: 'save_property',
                            property_id: propertyId,
                            property_type: propertyType,
                            search_location: null
                        });

                        window.dispatchEvent(new CustomEvent('saved-properties-updated', {
                            detail: {
                                propertyId: propertyId,
                                saved: true
                            }
                        }));
                    }
                } catch (error) {
                    console.error('Unable to update saved property:', error.message);

                    if (isCurrentlySaved) {
                        icon.classList.remove('ph');
                        icon.classList.add('ph-fill');
                        icon.style.color = '#e53e3e';
                        savedPropertyIds.add(propertyId);
                    } else {
                        icon.classList.remove('ph-fill');
                        icon.classList.add('ph');
                        icon.style.color = 'inherit';
                        savedPropertyIds.delete(propertyId);
                    }

                    alert('Unable to update saved spaces. Please check your connection and try again.');
                }

                return;
            }

            const negotiateBtn = target.closest('.negotiate-btn');

            if (negotiateBtn) {
                e.stopPropagation();

                const propertyId = negotiateBtn.getAttribute('data-id');
                const propertyType = negotiateBtn.getAttribute('data-type') || null;

                if (propertyId) {
                    recordTenantActivity({
                        activity_type: 'view_property',
                        property_id: propertyId,
                        property_type: propertyType,
                        search_location: null
                    });

                    window.location.href = `property-details.html?id=${propertyId}`;
                }

                return;
            }

            const cardElement = target.closest('.property-card');

            if (cardElement) {
                const targetPropId = cardElement.getAttribute('data-id');
                const propertyType = cardElement.querySelector('.property-type')?.innerText?.trim() || null;

                if (targetPropId) {
                    recordTenantActivity({
                        activity_type: 'view_property',
                        property_id: targetPropId,
                        property_type: propertyType,
                        search_location: null
                    });

                    window.location.href = `property-details.html?id=${targetPropId}`;
                }
            }
        });
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            currentPage++;
            fetchProperties(currentPage, true);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);

            const searchValue = searchInput.value.trim();

            if (searchValue.length >= 2) {
                debounceActivity(() => {
                    recordTenantActivity({
                        activity_type: 'search_location',
                        search_location: searchValue
                    });
                });
            }

            searchTimer = setTimeout(() => {
                resetAndFetchProperties();
            }, 400);
        });
    }

    if (filterType) {
        filterType.addEventListener('change', () => {
            const selectedType = filterType.value;

            if (selectedType && selectedType !== 'all') {
                recordTenantActivity({
                    activity_type: 'filter_type',
                    property_type: selectedType
                });
            }

            resetAndFetchProperties();
        });
    }

    if (filterPrice) {
        filterPrice.addEventListener('change', () => {
            const selectedPrice = filterPrice.value;
            const budget = getBudgetFromPriceFilter(selectedPrice);

            if (budget) {
                recordTenantActivity({
                    activity_type: 'filter_budget',
                    budget: budget
                });
            }

            resetAndFetchProperties();
        });
    }

    window.addEventListener('saved-properties-updated', async () => {
        await loadUserSavedPropertiesState();

        document.querySelectorAll('.save-btn').forEach(button => {
            const propertyId = button.getAttribute('data-id');
            const icon = button.querySelector('i');

            if (!icon || !propertyId) return;

            if (savedPropertyIds.has(propertyId)) {
                icon.classList.remove('ph');
                icon.classList.add('ph-fill');
                icon.style.color = '#e53e3e';
            } else {
                icon.classList.remove('ph-fill');
                icon.classList.add('ph');
                icon.style.color = 'inherit';
            }
        });

        setTimeout(() => {
            removeDuplicatePropertyCards();

            if (typeof window.personalizeBrowseRoomCards === 'function') {
                window.personalizeBrowseRoomCards();
                removeDuplicatePropertyCards();
            }
        }, 600);
    });

    fetchProperties(currentPage, false);
});