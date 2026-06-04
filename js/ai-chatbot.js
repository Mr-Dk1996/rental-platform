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

        if (q.includes('offer') || q.includes('negotiate') || q.includes('negotiation')) {
            return `
                To send an offer, open a property, enter your offer amount, write a short message to the landlord, and click <strong>Send Offer</strong>.
                You can then track the response in the <strong>Negotiations</strong> section.
            `;
        }

        if (q.includes('save') || q.includes('saved') || q.includes('bookmark')) {
            return `
                To save a property, click the heart/save button on a property card.
                You can later find it under <strong>Saved Spaces</strong>.
            `;
        }

        if (q.includes('lease') || q.includes('agreement')) {
            return `
                When a landlord accepts your offer, the property becomes occupied and your lease appears under <strong>My Lease</strong>.
                You can also print the lease document there.
            `;
        }

        if (q.includes('profile') || q.includes('phone') || q.includes('number')) {
            return `
                You can update your profile from the avatar button at the top-right of your dashboard.
                There you can add your phone numbers and update account details.
            `;
        }

        if (q.includes('payment') || q.includes('pay')) {
            return `
                Payment features are not active yet. RentHaven Ghana is saving payment features for the final phase.
            `;
        }

        if (q.includes('help') || q.includes('how')) {
            return `
                I can help you search for available rooms, explain how to send offers, save properties, check leases, and use your tenant dashboard.
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
            'bedroom'
        ];

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