(() => {
    let currentUser = null;
    let currentProfile = null;
    let currentProperty = null;

    let galleryImages = [];
    let currentGalleryIndex = 0;

    const urlParams = new URLSearchParams(window.location.search);
    const propertyId = urlParams.get('id');

    const setDOMText = (id, text) => {
        const el = document.getElementById(id);
        if (el) {
            el.innerText = text ?? '';
        }
    };

    const yesNo = (value) => {
        return value === true ? 'Yes' : 'No';
    };

    const setStatus = (message, type = 'info') => {
        const statusBox = document.getElementById('negotiation-status');
        if (!statusBox) return;

        const baseClass = 'mt-4 text-sm rounded-xl px-4 py-3';
        const styles = {
            success: 'bg-green-50 text-green-700 border border-green-200',
            error: 'bg-red-50 text-red-700 border border-red-200',
            info: 'bg-blue-50 text-blue-700 border border-blue-200',
            warning: 'bg-amber-50 text-amber-700 border border-amber-200'
        };

        statusBox.className = `${baseClass} ${styles[type] || styles.info}`;
        statusBox.innerText = message;
        statusBox.classList.remove('hidden');
    };

    const formatMoney = (amount) => {
        const numericAmount = Number(amount || 0);

        return numericAmount.toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    function updateGalleryDisplay(index = 0) {
        const mainImage = document.getElementById('main-image');
        const prevBtn = document.getElementById('gallery-prev-btn');
        const nextBtn = document.getElementById('gallery-next-btn');
        const counter = document.getElementById('gallery-counter');
        const thumbnailRow = document.getElementById('thumbnail-row');

        if (!mainImage) return;

        if (!galleryImages.length) {
            mainImage.src = 'https://via.placeholder.com/800x450?text=No+Property+Image+Available';

            if (prevBtn) prevBtn.classList.add('hidden');
            if (nextBtn) nextBtn.classList.add('hidden');
            if (counter) counter.classList.add('hidden');
            if (thumbnailRow) thumbnailRow.classList.add('hidden');

            return;
        }

        currentGalleryIndex = Math.max(0, Math.min(index, galleryImages.length - 1));

        mainImage.src = galleryImages[currentGalleryIndex];

        const hasMultipleImages = galleryImages.length > 1;

        if (prevBtn) {
            prevBtn.classList.toggle('hidden', !hasMultipleImages);
        }

        if (nextBtn) {
            nextBtn.classList.toggle('hidden', !hasMultipleImages);
        }

        if (counter) {
            counter.classList.toggle('hidden', !hasMultipleImages);
            counter.innerText = `${currentGalleryIndex + 1} / ${galleryImages.length}`;
        }

        if (thumbnailRow) {
            if (!hasMultipleImages) {
                thumbnailRow.classList.add('hidden');
                thumbnailRow.innerHTML = '';
            } else {
                thumbnailRow.classList.remove('hidden');

                thumbnailRow.innerHTML = galleryImages.map((imageUrl, imageIndex) => {
                    const activeClass = imageIndex === currentGalleryIndex
                        ? 'border-teal-600 ring-2 ring-teal-100 opacity-100'
                        : 'border-gray-200 opacity-70 hover:opacity-100';

                    return `
                        <button
                            type="button"
                            class="gallery-thumb flex-shrink-0 w-24 h-16 rounded-lg overflow-hidden border-2 ${activeClass} bg-gray-100 transition"
                            data-index="${imageIndex}"
                            aria-label="View property image ${imageIndex + 1}"
                        >
                            <img
                                src="${imageUrl}"
                                alt="Property thumbnail ${imageIndex + 1}"
                                class="w-full h-full object-cover"
                            >
                        </button>
                    `;
                }).join('');
            }
        }
    }

    function showNextImage() {
        if (galleryImages.length <= 1) return;

        const nextIndex = (currentGalleryIndex + 1) % galleryImages.length;
        updateGalleryDisplay(nextIndex);
    }

    function showPreviousImage() {
        if (galleryImages.length <= 1) return;

        const previousIndex = (currentGalleryIndex - 1 + galleryImages.length) % galleryImages.length;
        updateGalleryDisplay(previousIndex);
    }

    function bindGalleryEvents() {
        const prevBtn = document.getElementById('gallery-prev-btn');
        const nextBtn = document.getElementById('gallery-next-btn');
        const thumbnailRow = document.getElementById('thumbnail-row');
        const mainImage = document.getElementById('main-image');

        if (prevBtn) {
            prevBtn.addEventListener('click', showPreviousImage);
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', showNextImage);
        }

        if (mainImage) {
            mainImage.addEventListener('click', showNextImage);
        }

        if (thumbnailRow) {
            thumbnailRow.addEventListener('click', (e) => {
                const thumbBtn = e.target.closest('.gallery-thumb');

                if (!thumbBtn) return;

                const index = Number(thumbBtn.getAttribute('data-index'));

                if (Number.isFinite(index)) {
                    updateGalleryDisplay(index);
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            const container = document.getElementById('property-container');

            if (!container || container.classList.contains('hidden')) return;

            if (e.key === 'ArrowRight') {
                showNextImage();
            }

            if (e.key === 'ArrowLeft') {
                showPreviousImage();
            }
        });
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

    async function getCurrentUserAndProfile() {
        const { data: authData, error: authError } = await supabaseClient.auth.getUser();

        if (authError || !authData?.user) {
            currentUser = null;
            currentProfile = null;
            return;
        }

        currentUser = authData.user;

        const { data: profile, error: profileError } = await supabaseClient
            .from('users')
            .select('id, role, full_name, phone, phone_number')
            .eq('id', currentUser.id)
            .maybeSingle();

        if (profileError) {
            console.error('Profile lookup error:', profileError);
            currentProfile = null;
            return;
        }

        currentProfile = profile || null;
        updatePropertyDetailsNavigation();
    }

    async function loadPropertyImages(property) {
        let images = [];

        try {
            const { data: imageData, error: imageError } = await supabaseClient
                .from('property_images')
                .select('storage_path, is_primary, created_at')
                .eq('property_id', propertyId)
                .order('is_primary', { ascending: false })
                .order('created_at', { ascending: true });

            if (imageError) throw imageError;

            images = (imageData || [])
                .map(item => item.storage_path)
                .filter(Boolean);
        } catch (imageLookupError) {
            console.warn('Property image gallery lookup skipped:', imageLookupError.message);
        }

        if (images.length === 0 && Array.isArray(property.images) && property.images.length > 0) {
            images = property.images.filter(Boolean);
        }

        galleryImages = [...new Set(images)];
        currentGalleryIndex = 0;

        updateGalleryDisplay(0);
    }

    function updatePropertyDetailsNavigation() {
    const brandHomeLink = document.getElementById('brand-home-link');
    const dashboardLink = document.getElementById('dashboard-link');
    const browseLink = document.getElementById('browse-link');

    let targetDashboard = 'index.html';

    if (currentProfile?.role === 'Landlord') {
        targetDashboard = 'landlord-dashboard.html';
    }

    if (currentProfile?.role === 'Tenant') {
        targetDashboard = 'tenant-dashboard.html';
    }

    if (brandHomeLink) {
        brandHomeLink.href = targetDashboard;
    }

    if (dashboardLink) {
        dashboardLink.href = targetDashboard;
    }

    if (browseLink) {
        browseLink.href = targetDashboard;
    }
}

    async function loadPropertyDetails() {
        const loadingState = document.getElementById('loading-state');
        const propertyContainer = document.getElementById('property-container');

        if (!propertyId) {
            if (loadingState) {
                loadingState.innerHTML = `
                    <p class="text-red-500 font-semibold text-center">
                        Error: No property ID was provided.
                    </p>
                `;
            }
            return;
        }

        try {
            await getCurrentUserAndProfile();

            const { data: property, error } = await supabaseClient
                .from('properties')
                .select(`
                    *,
                    landlord:landlord_id (
                        id,
                        full_name,
                        phone,
                        phone_number
                    )
                `)
                .eq('id', propertyId)
                .single();

            if (error) throw error;
            if (!property) throw new Error('Property record was not found.');

            currentProperty = property;

            setDOMText('prop-title', property.title || 'Untitled Property');
            setDOMText('prop-location', property.location || property.location_tag || 'Location Not Specified');

            const descriptionText = property.description && String(property.description).trim()
                ? property.description
                : 'No detailed description has been provided for this property. Contact the landlord or send an offer for more information.';

            setDOMText('prop-desc', descriptionText);

            if (property.price_ghs !== undefined && property.price_ghs !== null) {
                setDOMText('prop-price', `GH₵ ${formatMoney(property.price_ghs)}`);
            }

            const amenities = property.amenities || {};

            const indoorBathroom = property.has_indoor_bathroom ?? amenities.has_indoor_bathroom ?? false;
            const toiletWc = property.has_toilet_wc ?? amenities.has_toilet_wc ?? false;
            const indoorKitchen = property.has_indoor_kitchen ?? amenities.has_indoor_kitchen ?? false;

            setDOMText('spec-type', property.type || amenities.type || 'Room');
            setDOMText('spec-beds', property.bedrooms ?? amenities.beds ?? '0');
            setDOMText('spec-baths', property.bathrooms ?? amenities.baths ?? '0');
            setDOMText('spec-condition', property.condition || amenities.condition || 'Not specified');
            setDOMText('spec-furnishing', property.furnishing || amenities.furnishing || 'Not specified');
            setDOMText('spec-meter-type', property.meter_type || amenities.meter_type || 'Not specified');
            setDOMText('spec-indoor-bathroom', yesNo(indoorBathroom));
            setDOMText('spec-toilet-wc', yesNo(toiletWc));
            setDOMText('spec-indoor-kitchen', yesNo(indoorKitchen));
            setDOMText('spec-status', property.status || 'Available');

            await loadPropertyImages(property);

            const negotiableBadge = document.getElementById('prop-negotiable');
            if (negotiableBadge) {
                const isNegotiable = property.is_negotiable === true || property.is_negotiable === 'true';

                if (isNegotiable) {
                    negotiableBadge.classList.remove('hidden');
                    negotiableBadge.classList.add('inline-block');
                } else {
                    negotiableBadge.classList.add('hidden');
                }
            }

            const landlordName = property.landlord?.full_name || 'Property Owner';
            const landlordPhone = property.landlord?.phone || property.landlord?.phone_number || '';

            setDOMText('agent-name', landlordName);

            if (landlordName) {
                setDOMText('agent-initial', landlordName.charAt(0).toUpperCase());
            }

            const btnContact = document.getElementById('btn-show-contact');
            if (btnContact) {
                btnContact.onclick = () => {
                    btnContact.innerText = landlordPhone ? `📞 ${landlordPhone}` : 'No number provided';
                    btnContact.classList.remove('bg-teal-600', 'hover:bg-teal-700', 'text-white');
                    btnContact.classList.add('bg-gray-100', 'text-teal-700');
                    btnContact.style.pointerEvents = 'none';
                };
            }

            setupNegotiationArea();

            if (loadingState) {
                loadingState.classList.add('hidden');
            }

            if (propertyContainer) {
                propertyContainer.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Critical fetching execution caught:', err);

            if (loadingState) {
                loadingState.innerHTML = `
                    <div style="text-align: center; padding: 24px; max-width: 480px; margin: 0 auto;">
                        <p style="color: #ef4444; font-weight: 700;">Failed to load property details.</p>
                        <p style="color: #94a3b8; font-size: 0.9rem; margin-top: 6px;">${err.message}</p>
                    </div>
                `;
            }
        }
    }

    function setupNegotiationArea() {
        const card = document.getElementById('negotiation-card');
        const form = document.getElementById('negotiation-form');
        const submitBtn = document.getElementById('submit-offer-btn');
        const offerInput = document.getElementById('offer-amount');

        if (!card || !form || !submitBtn || !offerInput) return;

        if (!currentUser) {
            form.classList.add('hidden');
            setStatus('Please log in as a tenant before sending an offer.', 'warning');
            submitBtn.disabled = true;
            return;
        }

        if (!currentProfile) {
            form.classList.add('hidden');
            setStatus('Your profile could not be verified. Please log in again.', 'error');
            submitBtn.disabled = true;
            return;
        }

        if (currentProfile.role !== 'Tenant') {
            form.classList.add('hidden');

            if (currentProfile.role === 'Landlord') {
                setStatus('Landlord accounts cannot send offers. Use a tenant account to test this feature.', 'warning');
            } else {
                setStatus('Only tenant accounts can send offers for properties.', 'warning');
            }

            submitBtn.disabled = true;
            return;
        }

        if (currentProperty?.landlord_id === currentUser.id) {
            form.classList.add('hidden');
            setStatus('You cannot negotiate for your own property listing.', 'warning');
            submitBtn.disabled = true;
            return;
        }

        if (currentProperty?.price_ghs) {
            offerInput.value = Number(currentProperty.price_ghs);
        }

        checkExistingNegotiation();
    }

    async function checkExistingNegotiation() {
        if (!currentUser || !propertyId) return;

        try {
            const { data: existingNegotiation, error } = await supabaseClient
                .from('negotiations')
                .select('id, offer_amount, status')
                .eq('property_id', propertyId)
                .eq('tenant_id', currentUser.id)
                .maybeSingle();

            if (error) throw error;

            const link = document.getElementById('go-to-negotiations');

            if (existingNegotiation) {
                const offerInput = document.getElementById('offer-amount');
                if (offerInput && existingNegotiation.offer_amount) {
                    offerInput.value = Number(existingNegotiation.offer_amount);
                }

                if (existingNegotiation.status === 'Accepted') {
                    setStatus('This offer has already been accepted. Open your tenant dashboard to continue chatting or view the lease section.', 'success');

                    const btn = document.getElementById('submit-offer-btn');
                    if (btn) {
                        btn.innerText = 'Offer Accepted';
                        btn.disabled = true;
                        btn.classList.add('opacity-60', 'cursor-not-allowed');
                    }
                } else if (existingNegotiation.status === 'Pending') {
                    setStatus('You already have a pending offer for this property. Submitting again will update your offer amount and message.', 'info');
                } else if (existingNegotiation.status === 'Rejected') {
                    setStatus('Your previous offer was rejected. You can submit a new offer for reconsideration.', 'warning');
                } else if (existingNegotiation.status === 'Cancelled') {
                    setStatus('Your previous negotiation was cancelled. You can submit a new offer.', 'warning');
                }

                if (link) {
                    link.classList.remove('hidden');
                }
            }
        } catch (err) {
            console.warn('Existing negotiation check skipped:', err.message);
        }
    }

    async function submitNegotiation(e) {
        e.preventDefault();

        const submitBtn = document.getElementById('submit-offer-btn');
        const offerInput = document.getElementById('offer-amount');
        const messageInput = document.getElementById('offer-message');
        const dashboardLink = document.getElementById('go-to-negotiations');

        if (!currentUser) {
            setStatus('Please log in before sending an offer.', 'warning');
            return;
        }

        if (!currentProfile || currentProfile.role !== 'Tenant') {
            setStatus('Only tenant accounts can send offers.', 'warning');
            return;
        }

        if (!currentProperty) {
            setStatus('Property details are not ready. Refresh the page and try again.', 'error');
            return;
        }

        if (currentProperty.landlord_id === currentUser.id) {
            setStatus('You cannot send an offer to your own property.', 'warning');
            return;
        }

        const offerAmount = Number(offerInput?.value);
        const messageText = String(messageInput?.value || '').trim();

        if (!Number.isFinite(offerAmount) || offerAmount <= 0) {
            setStatus('Enter a valid offer amount greater than zero.', 'error');
            return;
        }

        if (!messageText) {
            setStatus('Write a short message to the landlord before sending your offer.', 'error');
            return;
        }

        if (messageText.length > 1000) {
            setStatus('Your message is too long. Keep it within 1000 characters.', 'error');
            return;
        }

        const originalText = submitBtn.innerText;

        try {
            submitBtn.disabled = true;
            submitBtn.innerText = 'Sending Offer...';

            const { data: existingNegotiation, error: existingError } = await supabaseClient
                .from('negotiations')
                .select('id, status')
                .eq('property_id', propertyId)
                .eq('tenant_id', currentUser.id)
                .maybeSingle();

            if (existingError) throw existingError;

            let negotiationId = null;
            let notificationTitle = 'New Offer Received';
            let notificationMessage = '';

            if (existingNegotiation) {
                if (existingNegotiation.status === 'Accepted') {
                    setStatus('This offer has already been accepted. You cannot replace an accepted offer.', 'success');
                    return;
                }

                const { data: updatedNegotiation, error: updateError } = await supabaseClient
                    .from('negotiations')
                    .update({
                        offer_amount: offerAmount,
                        status: 'Pending'
                    })
                    .eq('id', existingNegotiation.id)
                    .select('id')
                    .single();

                if (updateError) throw updateError;

                negotiationId = updatedNegotiation.id;
                notificationTitle = 'Offer Updated';
            } else {
                const { data: insertedNegotiation, error: insertError } = await supabaseClient
                    .from('negotiations')
                    .insert([{
                        property_id: propertyId,
                        tenant_id: currentUser.id,
                        landlord_id: currentProperty.landlord_id,
                        offer_amount: offerAmount,
                        status: 'Pending'
                    }])
                    .select('id')
                    .single();

                if (insertError) throw insertError;

                negotiationId = insertedNegotiation.id;
                notificationTitle = 'New Offer Received';
            }

            const propertyTitle = currentProperty.title || 'this property';
            const tenantName = currentProfile.full_name || 'A tenant';
            const finalMessage = `Offer: GH₵ ${formatMoney(offerAmount)}\n\n${messageText}`;

            const { error: messageError } = await supabaseClient
                .from('messages')
                .insert([{
                    negotiation_id: negotiationId,
                    sender_id: currentUser.id,
                    content: finalMessage
                }]);

            if (messageError) throw messageError;

            notificationMessage =
                `${tenantName} sent an offer of GH₵ ${formatMoney(offerAmount)} for "${propertyTitle}".`;

            await createNotification(
                currentProperty.landlord_id,
                notificationTitle,
                notificationMessage,
                'offer',
                negotiationId
            );

            messageInput.value = '';

            setStatus(`Your offer for "${propertyTitle}" has been sent to the landlord successfully.`, 'success');

            if (dashboardLink) {
                dashboardLink.classList.remove('hidden');
            }

            submitBtn.innerText = 'Offer Sent';
            setTimeout(() => {
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            }, 2500);
        } catch (err) {
            console.error('Negotiation submission error:', err);
            setStatus(err.message || 'Unable to send offer. Please try again.', 'error');

            submitBtn.innerText = originalText;
            submitBtn.disabled = false;
        }
    }

    function bindEvents() {
        const negotiationForm = document.getElementById('negotiation-form');

        if (negotiationForm) {
            negotiationForm.addEventListener('submit', submitNegotiation);
        }

        bindGalleryEvents();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            bindEvents();
            loadPropertyDetails();
        });
    } else {
        bindEvents();
        loadPropertyDetails();
    }
})();