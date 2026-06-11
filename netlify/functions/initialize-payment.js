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

        const body = JSON.parse(event.body || '{}');

        const {
            tenant_id,
            landlord_id,
            property_id,
            negotiation_id,
            email,
            amount,
            property_title
        } = body;

        if (!tenant_id || !landlord_id || !property_id || !email || !amount) {
            return jsonResponse(400, {
                error: 'Missing required payment details.'
            });
        }

        const amountNumber = Number(amount);

        if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
            return jsonResponse(400, {
                error: 'Invalid payment amount.'
            });
        }

        const paymentReference = `RH-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const amountInPesewas = Math.round(amountNumber * 100);

        const paymentPayload = {
            tenant_id,
            landlord_id,
            property_id,
            negotiation_id: negotiation_id || null,
            amount: amountNumber,
            currency: 'GHS',
            payment_status: 'pending',
            payment_reference: paymentReference,
            payment_provider: 'paystack',
            description: `Rent payment for ${property_title || 'property'}`
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
                    tenant_id,
                    landlord_id,
                    property_id,
                    negotiation_id: negotiation_id || null
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