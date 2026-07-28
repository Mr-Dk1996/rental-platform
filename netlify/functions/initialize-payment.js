const crypto = require('crypto');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.SITE_URL;

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify(body)
    };
}

function getPaystackEnvironment(secretKey) {
    const key = String(secretKey || '').toLowerCase();

    if (key.startsWith('sk_live_')) return 'live';
    if (key.startsWith('sk_test_')) return 'test';

    return 'unknown';
}

async function readJson(response) {
    const text = await response.text();

    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}

async function getAuthenticatedUser(accessToken) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${accessToken}`
        }
    });
    const data = await readJson(response);

    if (!response.ok || !data?.id) return null;

    return data;
}

async function getSingleRecord(table, query) {
    const response = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?${query}`,
        {
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                Accept: 'application/vnd.pgrst.object+json'
            }
        }
    );
    const data = await readJson(response);

    return { response, data };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(200, { message: 'OK' });
    }

    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' });
    }

    try {
        if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SITE_URL) {
            return jsonResponse(500, {
                error: 'Payment server is not fully configured.'
            });
        }

        const authorization = event.headers.authorization || event.headers.Authorization || '';
        const accessToken = authorization.startsWith('Bearer ')
            ? authorization.slice(7).trim()
            : '';

        if (!accessToken) {
            return jsonResponse(401, {
                error: 'Your login session is missing or expired. Please log in again.'
            });
        }

        const authenticatedUser = await getAuthenticatedUser(accessToken);

        if (!authenticatedUser) {
            return jsonResponse(401, {
                error: 'Your login session is invalid or expired. Please log in again.'
            });
        }

        const body = JSON.parse(event.body || '{}');
        const propertyId = String(body.property_id || '').trim();
        const negotiationId = String(body.negotiation_id || '').trim();

        if (!propertyId || !negotiationId) {
            return jsonResponse(400, {
                error: 'Missing property or accepted lease information.'
            });
        }

        const negotiationQuery = new URLSearchParams({
            select: 'id,tenant_id,landlord_id,property_id,offer_amount,status',
            id: `eq.${negotiationId}`
        }).toString();
        const {
            response: negotiationResponse,
            data: negotiation
        } = await getSingleRecord('negotiations', negotiationQuery);

        if (!negotiationResponse.ok || !negotiation?.id) {
            return jsonResponse(404, {
                error: 'The accepted lease could not be found.'
            });
        }

        if (
            String(negotiation.tenant_id) !== String(authenticatedUser.id) ||
            String(negotiation.property_id) !== propertyId
        ) {
            return jsonResponse(403, {
                error: 'You are not authorized to pay for this lease.'
            });
        }

        if (String(negotiation.status || '').toLowerCase() !== 'accepted') {
            return jsonResponse(400, {
                error: 'Payment can only be made for an accepted lease.'
            });
        }

        const propertyQuery = new URLSearchParams({
            select: 'id,title,price_ghs',
            id: `eq.${propertyId}`
        }).toString();
        const {
            response: propertyResponse,
            data: property
        } = await getSingleRecord('properties', propertyQuery);

        if (!propertyResponse.ok || !property?.id) {
            return jsonResponse(404, {
                error: 'The property for this lease could not be found.'
            });
        }

        const tenantId = authenticatedUser.id;
        const landlordId = negotiation.landlord_id;
        const email = authenticatedUser.email;
        const amountNumber = Number(negotiation.offer_amount || property.price_ghs);
        const propertyTitle = property.title || 'property';

        if (!landlordId || !email) {
            return jsonResponse(400, {
                error: 'The lease is missing landlord or tenant contact information.'
            });
        }

        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            return jsonResponse(400, {
                error: 'Invalid payment amount.'
            });
        }

        const paymentReference = `RH-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const amountInPesewas = Math.round(amountNumber * 100);

        const paymentPayload = {
            tenant_id: tenantId,
            landlord_id: landlordId,
            property_id: propertyId,
            negotiation_id: negotiationId,
            amount: amountNumber,
            currency: 'GHS',
            payment_status: 'pending',
            payment_reference: paymentReference,
            payment_provider: 'paystack',
            payment_environment: getPaystackEnvironment(PAYSTACK_SECRET_KEY),
            description: `Rent payment for ${propertyTitle}`
        };

        const createPaymentResponse = await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                Prefer: 'return=representation'
            },
            body: JSON.stringify(paymentPayload)
        });

        const createdPayment = await createPaymentResponse.json();

        if (!createPaymentResponse.ok) {
            return jsonResponse(createPaymentResponse.status, {
                error: 'Unable to create payment record.',
                details: createdPayment
            });
        }

        const paymentId = createdPayment?.[0]?.id;

        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                amount: amountInPesewas,
                currency: 'GHS',
                reference: paymentReference,
                callback_url: `${SITE_URL}/payment-callback.html?reference=${paymentReference}`,
                metadata: {
                    payment_id: paymentId,
                    tenant_id: tenantId,
                    landlord_id: landlordId,
                    property_id: propertyId,
                    negotiation_id: negotiationId
                }
            })
        });

        const paystackData = await paystackResponse.json();

        if (!paystackResponse.ok || !paystackData.status) {
            await fetch(`${SUPABASE_URL}/rest/v1/payments?payment_reference=eq.${paymentReference}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    payment_status: 'failed'
                })
            });

            return jsonResponse(400, {
                error: 'Unable to initialize Paystack payment.',
                details: paystackData
            });
        }

        return jsonResponse(200, {
            message: 'Payment initialized successfully.',
            payment_id: paymentId,
            reference: paymentReference,
            authorization_url: paystackData.data.authorization_url
        });
    } catch (error) {
        return jsonResponse(500, {
            error: 'Payment initialization failed.',
            details: error.message
        });
    }
};
