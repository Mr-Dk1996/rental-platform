(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const landlordId = urlParams.get('landlord_id');

    const loadingState = document.getElementById('loading-state');
    const profileContainer = document.getElementById('profile-container');
    const propertiesGrid = document.getElementById('landlord-properties-grid');

    function setText(id, value) {
        const el = document.getElementById(id);

        if (el) {
            el.innerText = value || '';
        }
    }

    function formatMoney(value) {
        return Number(value || 0).toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function getInitial(name) {
        return String(name || 'L').charAt(0).toUpperCase();
    }

    function getPlaceholderImage() {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="700" height="450" viewBox="0 0 700 450">
            <rect width="700" height="450" fill="#f1f5f9"/>
            <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="Arial" font-size="28" font-weight="700">
                RentHaven Ghana
            </text>
            <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="Arial" font-size="18">
                No Property Image
            </text>
        </svg>
    `)}`;
}

function getPublicImageUrl(storagePath) {
    if (!storagePath) {
        return getPlaceholderImage();
    }

    if (String(storagePath).startsWith('http')) {
        return storagePath;
    }

    const { data } = supabaseClient
        .storage
        .from('property-images')
        .getPublicUrl(storagePath);

    return data?.publicUrl || getPlaceholderImage();
}

    async function getCurrentUserProfile() {
        try {
            const { data: authData, error: authError } = await supabaseClient.auth.getUser();

            if (authError || !authData?.user) {
                return null;
            }

            const { data: profile, error: profileError } = await supabaseClient
                .from('users')
                .select('id, role')
                .eq('id', authData.user.id)
                .maybeSingle();

            if (profileError) {
                return null;
            }

            return profile || null;
        } catch {
            return null;
        }
    }

  async function updateNavigation() {
    const brandHomeLink = document.getElementById('brand-home-link');
    const dashboardLink = document.querySelector('a[href="tenant-dashboard.html"]');

    const profile = await getCurrentUserProfile();

    let targetDashboard = 'index.html';
    let dashboardText = 'Home';

    if (profile?.role === 'Tenant') {
        targetDashboard = 'tenant-dashboard.html';
        dashboardText = 'Tenant Dashboard';
    }

    if (profile?.role === 'Landlord') {
        targetDashboard = 'landlord-dashboard.html';
        dashboardText = 'Landlord Dashboard';
    }

    if (profile?.role === 'Admin') {
        targetDashboard = 'admin-dashboard.html';
        dashboardText = 'Admin Dashboard';
    }

    if (brandHomeLink) {
        brandHomeLink.href = targetDashboard;
    }

    if (dashboardLink) {
        dashboardLink.href = targetDashboard;
        dashboardLink.innerText = dashboardText;
    }

    return profile;
}

function showLoginRequiredMessage() {
    if (!loadingState) return;

    loadingState.innerHTML = `
        <div class="bg-white border border-teal-100 rounded-2xl p-8 max-w-lg mx-auto text-center shadow-sm">
            <div class="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span class="text-2xl">🔐</span>
            </div>

            <h2 class="text-xl font-extrabold text-gray-900 mb-2">
                Sign in required
            </h2>

            <p class="text-gray-500 text-sm leading-6 mb-6">
                Please sign in as a tenant, landlord to view landlord profiles and their listed properties.
            </p>

            <div class="flex flex-col sm:flex-row gap-3 justify-center">
                <a
                    href="index.html"
                    class="bg-teal-600 hover:bg-teal-700 text-white font-semibold px-5 py-3 rounded-xl transition"
                >
                    Go to Login
                </a>

                <a
                    href="index.html"
                    class="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-5 py-3 rounded-xl transition"
                >
                    Return Home
                </a>
            </div>
        </div>
    `;
}

    async function loadLandlordProfile() {
        const currentViewerProfile = await updateNavigation();

if (!currentViewerProfile) {
    showLoginRequiredMessage();
    return;
}

        if (!landlordId) {
            if (loadingState) {
                loadingState.innerHTML = `
                    <p class="text-red-500 font-semibold">
                        No landlord ID was provided.
                    </p>
                `;
            }
            return;
        }

        try {
            const { data: landlord, error: landlordError } = await supabaseClient
                .from('users')
                .select('id, full_name, email, phone, phone_number, phone_alt, profile_photo_url')
                .eq('id', landlordId)
                .maybeSingle();

            if (landlordError) throw landlordError;

            if (!landlord) {
                throw new Error('Landlord profile was not found.');
            }

            const landlordName = landlord.full_name || 'Property Owner';
            const phone = landlord.phone || landlord.phone_number || '';
            const altPhone = landlord.phone_alt || '';
            const email = landlord.email || '';

            setText('landlord-name', landlordName);
            setText('landlord-initial', getInitial(landlordName));

            setText('landlord-phone', phone ? `Phone: ${phone}` : 'Phone: Not provided');

            const altPhoneEl = document.getElementById('landlord-alt-phone');
            if (altPhoneEl && altPhone) {
                altPhoneEl.innerText = `Alt: ${altPhone}`;
                altPhoneEl.classList.remove('hidden');
            }

            const emailEl = document.getElementById('landlord-email');
            if (emailEl && email) {
                emailEl.innerText = `Email: ${email}`;
                emailEl.classList.remove('hidden');
            }

            await loadLandlordProperties();

            if (loadingState) {
                loadingState.classList.add('hidden');
            }

            if (profileContainer) {
                profileContainer.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Landlord profile loading error:', err);

            if (loadingState) {
                loadingState.innerHTML = `
                    <div class="bg-white border border-red-100 rounded-2xl p-6 max-w-lg mx-auto">
                        <p class="text-red-600 font-bold">Failed to load landlord profile.</p>
                        <p class="text-gray-500 text-sm mt-2">${err.message}</p>
                        <a href="index.html" class="inline-block mt-4 text-teal-700 font-semibold">
                            Return Home
                        </a>
                    </div>
                `;
            }
        }
    }

    async function loadLandlordProperties() {
        const { data: properties, error: propertyError } = await supabaseClient
    .from('properties')
    .select('*')
    .eq('landlord_id', landlordId)
    .eq('status', 'Available')
    .order('created_at', { ascending: false });

        if (propertyError) throw propertyError;

        const propertyRows = properties || [];

        setText('landlord-property-count', String(propertyRows.length));

        if (!propertiesGrid) return;

        if (propertyRows.length === 0) {
            propertiesGrid.innerHTML = `
                <div class="col-span-full bg-white border border-gray-100 rounded-2xl p-8 text-center">
                    <h3 class="font-bold text-gray-900">No active properties found</h3>
                    <p class="text-gray-500 text-sm mt-2">
                        This landlord does not currently have available listings.
                    </p>
                </div>
            `;
            return;
        }

        const propertyIds = propertyRows.map(property => property.id);

        let imageMap = {};

        try {
            const { data: images, error: imageError } = await supabaseClient
                .from('property_images')
                .select('property_id, storage_path, is_primary, created_at')
                .in('property_id', propertyIds)
                .order('is_primary', { ascending: false })
                .order('created_at', { ascending: true });

            if (imageError) throw imageError;

            (images || []).forEach(image => {
                if (!imageMap[image.property_id]) {
                    imageMap[image.property_id] = image.storage_path;
                }
            });
        } catch (imageErr) {
            console.warn('Landlord property image lookup skipped:', imageErr.message);
        }

        propertiesGrid.innerHTML = propertyRows.map(property => {
    const fallbackImageFromProperty = Array.isArray(property.images) && property.images.length > 0
        ? property.images[0]
        : null;

    const imageSource = imageMap[property.id] || fallbackImageFromProperty;
    const imageUrl = getPublicImageUrl(imageSource);
            const title = property.title || 'Untitled Property';
            const location = property.location || property.location_tag || 'Location not specified';
            const type = property.type || 'Room';
            const status = property.status || 'Available';
            const price = formatMoney(property.price_ghs);

            return `
                <a
                    href="property-details.html?id=${property.id}"
                    class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-lg hover:-translate-y-1 transition block"
                >
                    <div class="h-48 bg-gray-100">
                        <img
                            src="${imageUrl}"
                            alt="${title}"
                            class="w-full h-full object-cover"
                        >
                    </div>

                    <div class="p-5">
                        <div class="flex items-center justify-between gap-3 mb-2">
                            <span class="text-xs font-bold uppercase tracking-wide text-teal-700">
                                ${type}
                            </span>

                            <span class="text-xs font-semibold px-2 py-1 rounded-full ${
                                status === 'Available'
                                    ? 'bg-green-50 text-green-700'
                                    : 'bg-amber-50 text-amber-700'
                            }">
                                ${status}
                            </span>
                        </div>

                        <h3 class="font-bold text-gray-900 leading-snug">
                            ${title}
                        </h3>

                        <p class="text-sm text-gray-500 mt-2">
                            📍 ${location}
                        </p>

                        <p class="text-lg font-extrabold text-teal-700 mt-4">
                            GH₵ ${price}
                        </p>
                    </div>
                </a>
            `;
        }).join('');
    }

    document.addEventListener('DOMContentLoaded', loadLandlordProfile);
})();