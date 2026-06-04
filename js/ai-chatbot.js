(() => {
    const toggleBtn = document.getElementById('ai-chatbot-toggle');
    const closeBtn = document.getElementById('ai-chatbot-close');
    const panel = document.getElementById('ai-chatbot-panel');
    const form = document.getElementById('ai-chatbot-form');
    const input = document.getElementById('ai-chatbot-input');
    const messages = document.getElementById('ai-chatbot-messages');
    const suggestions = document.getElementById('ai-chatbot-suggestions');

    if (!toggleBtn || !panel || !form || !input || !messages) return;

    function normalizeText(value) {
        return String(value || '').toLowerCase().trim();
    }

    function formatMoney(value) {
        return Number(value || 0).toLocaleString('en-GH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function addMessage(content, sender = 'bot') {
        const bubble = document.createElement('div');
        bubble.className = `ai-message ${sender}`;
        bubble.innerHTML = content;
        messages.appendChild(bubble);
        messages.scrollTop = messages.scrollHeight;
    }

    function getHelpAnswer(query) {
    const q = normalizeText(query);

    // Signup / account creation
    if (
        q.includes('sign up') ||
        q.includes('signup') ||
        q.includes('register') ||
        q.includes('create account') ||
        q.includes('new account') ||
        q.includes('account')
    ) {
        return `
            To sign up on RentHaven Ghana:
            <br><br>
            1. Click <strong>Sign Up</strong> on the homepage.
            <br>
            2. Enter your full name, email address, password, and security answer.
            <br>
            3. Choose your account type: <strong>Tenant</strong> or <strong>Landlord</strong>.
            <br>
            4. Click <strong>Create Account</strong>.
            <br><br>
            You can also use <strong>Continue with Google as Tenant</strong> or <strong>Continue with Google as Landlord</strong>.
        `;
    }

    // Login
    if (
        q.includes('login') ||
        q.includes('log in') ||
        q.includes('sign in') ||
        q.includes('signin')
    ) {
        return `
            To log in:
            <br><br>
            1. Click <strong>Log In</strong> on the homepage.
            <br>
            2. Enter your email address and password.
            <br>
            3. Click <strong>Log In</strong>.
            <br><br>
            You can also use <strong>Continue with Google</strong> if your account was created with Google.
        `;
    }

    // Tenant explanation
    if (
        q.includes('tenant') ||
        q.includes('looking for room') ||
        q.includes('looking for a room') ||
        q.includes('looking for house') ||
        q.includes('rent a room')
    ) {
        return `
            A <strong>Tenant</strong> account is for users who are looking for rooms or properties to rent.
            <br><br>
            As a tenant, you can:
            <br>
            • Browse available properties
            <br>
            • Search and filter by location, type, and price
            <br>
            • Save properties
            <br>
            • Send offers to landlords
            <br>
            • Chat after negotiation
            <br>
            • View your accepted lease
        `;
    }

    // Landlord explanation
    if (
        q.includes('landlord') ||
        q.includes('property owner') ||
        q.includes('upload property') ||
        q.includes('add property') ||
        q.includes('list property') ||
        q.includes('post property')
    ) {
        return `
            A <strong>Landlord</strong> account is for property owners who want to list rooms or apartments.
            <br><br>
            As a landlord, you can:
            <br>
            • Add property listings
            <br>
            • Upload multiple property images
            <br>
            • Edit property details
            <br>
            • Receive tenant offers
            <br>
            • Accept or reject negotiations
            <br>
            • Manage active leases
        `;
    }

    // Offer / negotiation
    if (
        q.includes('offer') ||
        q.includes('negotiate') ||
        q.includes('negotiation') ||
        q.includes('send offer') ||
        q.includes('make offer')
    ) {
        return `
            To send an offer:
            <br><br>
            1. Open a property you like.
            <br>
            2. Enter your preferred rent amount.
            <br>
            3. Write a short message to the landlord.
            <br>
            4. Click <strong>Send Offer</strong>.
            <br><br>
            You can track the response in the <strong>Negotiations</strong> section of your tenant dashboard.
        `;
    }

    // Save properties
    if (
        q.includes('save') ||
        q.includes('saved') ||
        q.includes('bookmark') ||
        q.includes('favourite') ||
        q.includes('favorite')
    ) {
        return `
            To save a property, click the save/heart button on a property card.
            <br><br>
            Saved properties will appear under <strong>Saved Spaces</strong> in your tenant dashboard.
        `;
    }

    // Smart AI Match
    if (
        q.includes('smart ai') ||
        q.includes('ai match') ||
        q.includes('recommend') ||
        q.includes('recommendation') ||
        q.includes('match me') ||
        q.includes('suggest')
    ) {
        return `
            <strong>Smart AI Match</strong> helps tenants find suitable properties based on:
            <br><br>
            • Preferred location
            <br>
            • Property type
            <br>
            • Budget
            <br>
            • Bedroom preference
            <br>
            • Saved spaces and negotiation activity
            <br><br>
            Open <strong>Smart AI Match</strong> on your tenant dashboard and enter your preferences to generate matches.
        `;
    }

    // Lease
    if (
        q.includes('lease') ||
        q.includes('agreement') ||
        q.includes('accepted offer') ||
        q.includes('my lease')
    ) {
        return `
            When a landlord accepts your offer, the property becomes occupied and your accepted negotiation becomes an active lease.
            <br><br>
            You can view it under <strong>My Lease</strong> in your tenant dashboard. You can also print the lease document.
        `;
    }

    // Profile / phone / account settings
    if (
        q.includes('profile') ||
        q.includes('phone') ||
        q.includes('number') ||
        q.includes('update details') ||
        q.includes('account settings') ||
        q.includes('change password') ||
        q.includes('password')
    ) {
        return `
            To update your account:
            <br><br>
            1. Click your profile/avatar button at the top-right.
            <br>
            2. Choose <strong>View Profile</strong> or <strong>Account Settings</strong>.
            <br>
            3. You can update your name, phone numbers, email request, or password.
        `;
    }

    // Contact landlord
    if (
        q.includes('contact landlord') ||
        q.includes('landlord contact') ||
        q.includes('show contact') ||
        q.includes('call landlord')
    ) {
        return `
            To contact a landlord:
            <br><br>
            1. Open the property details page.
            <br>
            2. Click <strong>Show Contact Number</strong>.
            <br>
            3. You can also send an offer with a message to begin negotiation.
        `;
    }

    // Landlord profile
    if (
        q.includes('landlord profile') ||
        q.includes('other properties') ||
        q.includes('other listings') ||
        q.includes('same landlord')
    ) {
        return `
            On a property details page, tap the landlord profile area to view the landlord’s public profile.
            <br><br>
            The landlord profile shows a few landlord details and other available properties posted by that same landlord.
        `;
    }

    // Payments
    if (
        q.includes('payment') ||
        q.includes('pay') ||
        q.includes('receipt') ||
        q.includes('rent payment')
    ) {
        return `
            Payment features are planned for the final phase of RentHaven Ghana.
            <br><br>
            For now, the system focuses on property search, offers, negotiations, leases, profiles, admin reports, and AI-assisted property matching.
        `;
    }

    // About platform
    if (
        q.includes('what is renthaven') ||
        q.includes('about renthaven') ||
        q.includes('what does this system do') ||
        q.includes('purpose') ||
        q.includes('how does renthaven work')
    ) {
        return `
            <strong>RentHaven Ghana</strong> is a smart rental platform that connects tenants directly with landlords.
            <br><br>
            It helps tenants browse available rooms, save preferred spaces, send offers, negotiate with landlords, and manage accepted leases.
            Landlords can upload properties, receive offers, and manage listings.
        `;
    }

    // Admin
    if (
        q.includes('admin') ||
        q.includes('administrator') ||
        q.includes('manage users') ||
        q.includes('reports')
    ) {
        return `
            The <strong>Admin Dashboard</strong> helps monitor the platform.
            <br><br>
            Admin can:
            <br>
            • View users
            <br>
            • Change user roles
            <br>
            • Deactivate/reactivate users
            <br>
            • View property listings
            <br>
            • Monitor negotiations and active leases
            <br>
            • Generate printable reports
        `;
    }

    // Help
    if (
        q.includes('help') ||
        q.includes('guide') ||
        q.includes('what can you do') ||
        q.includes('how')
    ) {
        return `
            I can help you with:
            <br><br>
            • Searching available properties
            <br>
            • Finding rooms by location, type, or budget
            <br>
            • Explaining how to sign up or log in
            <br>
            • Explaining how to send offers
            <br>
            • Explaining saved spaces, leases, landlord profiles, and account settings
            <br><br>
            Try asking: <strong>“show rooms in Accra below 1500”</strong>.
        `;
    }

    return null;
}

    function extractBudget(query) {
        const q = normalizeText(query);

        const match = q.match(/(?:below|under|less than|max|maximum|budget|around)?\s*(?:ghs|gh₵|₵)?\s*([0-9]{3,7})/i);

        if (match && match[1]) {
            return Number(match[1]);
        }

        return null;
    }

    function detectPropertyType(query) {
        const q = normalizeText(query);

        if (q.includes('single')) return 'Single Room';
        if (q.includes('chamber')) return 'Chamber & Hall';
        if (q.includes('studio')) return 'Studio Apartment';
        if (q.includes('2 bedroom') || q.includes('two bedroom')) return '2 Bedroom';
        if (q.includes('apartment')) return 'Apartment';
        if (q.includes('full house')) return 'Full House';
        if (q.includes('townhouse')) return 'Townhouse';

        return null;
    }

    function extractLocation(query) {
        const q = normalizeText(query);

        const knownLocations = [
            'accra',
            'kumasi',
            'madina',
            'osu',
            'east legon',
            'legon',
            'spintex',
            'kasoa',
            'tema',
            'lapaz',
            'adenta',
            'achimota',
            'dansoman',
            'circle',
            'teshie',
            'nungua',
            'cape coast',
            'takoradi',
            'koforidua',
            'sunyani',
            'tamale'
        ];

        const foundKnownLocation = knownLocations.find(location => q.includes(location));

        if (foundKnownLocation) {
            return foundKnownLocation;
        }

        const locationPatterns = [
            /in\s+([a-zA-Z\s]{3,30})/,
            /at\s+([a-zA-Z\s]{3,30})/,
            /around\s+([a-zA-Z\s]{3,30})/,
            /near\s+([a-zA-Z\s]{3,30})/
        ];

        for (const pattern of locationPatterns) {
            const match = q.match(pattern);

            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return null;
    }

    function shouldSearchProperties(query) {
    const q = normalizeText(query);

    const searchWords = [
        'room',
        'rooms',
        'property',
        'properties',
        'house',
        'apartment',
        'rent',
        'available',
        'find',
        'search',
        'show',
        'recommend',
        'suggest',
        'space',
        'spaces',
        'chamber',
        'studio',
        'bedroom',
        'single room',
        '2 bedroom',
        'two bedroom',
        'full house',
        'townhouse'
    ];

    const helpOnlyWords = [
        'how do i sign up',
        'how to sign up',
        'how do i login',
        'how to login',
        'how do i log in',
        'how to create account',
        'how do i create account',
        'how do i send an offer',
        'how to send offer',
        'how do i save',
        'how do i update',
        'how do i change password'
    ];

    if (helpOnlyWords.some(phrase => q.includes(phrase))) {
        return false;
    }

    return searchWords.some(word => q.includes(word));
}

    async function searchProperties(query) {
        const budget = extractBudget(query);
        const propertyType = detectPropertyType(query);
        const location = extractLocation(query);

        let request = supabaseClient
            .from('properties')
            .select('*')
            .eq('status', 'Available')
            .order('created_at', { ascending: false })
            .limit(8);

        if (budget) {
            request = request.lte('price_ghs', budget);
        }

        if (propertyType) {
            request = request.eq('type', propertyType);
        }

        const { data, error } = await request;

        if (error) throw error;

        let results = data || [];

        if (location) {
            const cleanLocation = normalizeText(location);

            results = results.filter(property => {
                const propertyLocation = normalizeText(`${property.location || ''} ${property.location_tag || ''}`);
                return propertyLocation.includes(cleanLocation);
            });
        }

        return {
            results,
            budget,
            propertyType,
            location
        };
    }

    function renderPropertyResults(searchData) {
        const { results, budget, propertyType, location } = searchData;

        if (!results.length) {
            let reason = 'I could not find matching available properties right now.';

            if (location || budget || propertyType) {
                reason += ' Try increasing your budget, changing the location, or searching without property type.';
            }

            return reason;
        }

        let summary = `I found <strong>${results.length}</strong> available propert${results.length === 1 ? 'y' : 'ies'}`;

        const filters = [];

        if (location) filters.push(`location: <strong>${location}</strong>`);
        if (propertyType) filters.push(`type: <strong>${propertyType}</strong>`);
        if (budget) filters.push(`budget: <strong>GH₵ ${formatMoney(budget)}</strong> or below`);

        if (filters.length) {
            summary += ` matching ${filters.join(', ')}`;
        }

        summary += '.';

        const cards = results.slice(0, 5).map(property => {
            const title = property.title || 'Untitled Property';
            const locationText = property.location || property.location_tag || 'Location not specified';
            const type = property.type || 'Room';
            const price = formatMoney(property.price_ghs);

            return `
                <div class="ai-property-result">
                    <h4>${title}</h4>
                    <p>📍 ${locationText}</p>
                    <p>${type} • GH₵ ${price}</p>
                    <a href="property-details.html?id=${property.id}">View property</a>
                </div>
            `;
        }).join('');

        return `${summary}${cards}`;
    }

    async function handleUserMessage(message) {
        const helpAnswer = getHelpAnswer(message);

        if (helpAnswer && !shouldSearchProperties(message)) {
            addMessage(helpAnswer, 'bot');
            return;
        }

        if (shouldSearchProperties(message)) {
            addMessage('Searching available properties for you...', 'bot');

            try {
                const searchData = await searchProperties(message);
                const response = renderPropertyResults(searchData);
                addMessage(response, 'bot');
            } catch (err) {
                console.error('AI property search error:', err);
                addMessage('Sorry, I could not search properties right now. Please refresh and try again.', 'bot');
            }

            return;
        }

        if (helpAnswer) {
            addMessage(helpAnswer, 'bot');
            return;
        }

        addMessage(`
            I can help with property search and RentHaven guidance.
            Try asking: <strong>“show rooms in Accra below 1500”</strong> or <strong>“how do I send an offer?”</strong>
        `, 'bot');
    }

    function openChatbot() {
        panel.classList.add('open');
        setTimeout(() => input.focus(), 100);
    }

    function closeChatbot() {
        panel.classList.remove('open');
    }

    toggleBtn.addEventListener('click', () => {
        if (panel.classList.contains('open')) {
            closeChatbot();
        } else {
            openChatbot();
        }
    });

    closeBtn?.addEventListener('click', closeChatbot);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const message = input.value.trim();

        if (!message) return;

        addMessage(message, 'user');
        input.value = '';

        await handleUserMessage(message);
    });

    suggestions?.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-ai-suggestion]');
        if (!btn) return;

        const suggestionText = btn.getAttribute('data-ai-suggestion');

        if (!suggestionText) return;

        addMessage(suggestionText, 'user');
        await handleUserMessage(suggestionText);
    });
})();