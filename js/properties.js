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

    function escapeSupabaseOrValue(value) {
        return String(value || '')
            .replace(/[%]/g, '\\%')
            .replace(/[_]/g, '\\_')
            .replace(/,/g, '\\,')
            .trim();
    }

    function getCurrentFilters() {
        return {
            search: searchInput ? searchInput.value.trim() : '',
            type: filterType ? filterType.value : 'all',
            price: filterPrice ? filterPrice.value : 'all'
        };
    }

    function resetAndFetchProperties() {
        currentPage = 0;
        fetchProperties(0, false);
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
            renderProperties(properties || [], append);

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

        properties.forEach(property => {
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

            const cardHTML = `
                <div class="property-card" style="cursor: pointer;" data-id="${property.id}">
                    <div class="image-container">
                        <img src="${imageUrl}" alt="${property.title || 'Property'}" loading="lazy">
                    </div>

                    <div class="card-content">
                        <div class="property-type">${propType}</div>

                        <h3 class="property-card-title" style="margin: 8px 0; font-size: 1.15rem; font-weight: 600;">
                            ${property.title || 'Untitled Property'}
                        </h3>

                        <div class="location" style="display: flex; align-items: center; gap: 4px; color: #64748b; margin-bottom: 12px;">
                            <i class="ph ph-map-pin"></i> ${property.location || 'Location not specified'}
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
                                class="btn-outline save-btn"
                                data-id="${property.id}"
                                style="padding: 12px; display: flex; align-items: center; justify-content: center; width: 48px; min-width: 48px;"
                                aria-label="Save property"
                            >
                                <i class="${heartIconClass} ph-heart" style="font-size: 1.2rem; color: ${heartColor};"></i>
                            </button>

                            <button
                                class="btn-primary negotiate-btn"
                                data-id="${property.id}"
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
    }

    if (gridContainer) {
        gridContainer.addEventListener('click', async (e) => {
            const target = e.target;

            const saveBtn = target.closest('.save-btn');

            if (saveBtn) {
                e.stopPropagation();

                const propertyId = saveBtn.getAttribute('data-id');
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

                if (propertyId) {
                    window.location.href = `property-details.html?id=${propertyId}`;
                }

                return;
            }

            const cardElement = target.closest('.property-card');

            if (cardElement) {
                const targetPropId = cardElement.getAttribute('data-id');

                if (targetPropId) {
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

            searchTimer = setTimeout(() => {
                resetAndFetchProperties();
            }, 400);
        });
    }

    if (filterType) {
        filterType.addEventListener('change', resetAndFetchProperties);
    }

    if (filterPrice) {
        filterPrice.addEventListener('change', resetAndFetchProperties);
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
    });

    fetchProperties(currentPage, false);
});