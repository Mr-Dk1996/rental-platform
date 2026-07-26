const crypto = require('crypto');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.SITE_URL;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '';

function normalizeOrigin(value) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

function getAllowedOrigins() {
    const origins = new Set();

    const siteOrigin = normalizeOrigin(SITE_URL);

    if (siteOrigin) {
        origins.add(siteOrigin);
    }

    ALLOWED_ORIGINS
        .split(',')
        .map((origin) => normalizeOrigin(origin.trim()))
        .filter(Boolean)
        .forEach((origin) => origins.add(origin));

    return origins;
}

function resolveCorsOrigin(event) {
    const allowedOrigins = getAllowedOrigins();
    const requestOrigin =
        event.headers?.origin ||
        event.headers?.Origin ||
        null;

    /*
      Requests without an Origin header may come from trusted
      server tools or direct testing.
    */
    if (!requestOrigin) {
        return {
            allowed: true,
            origin: normalizeOrigin(SITE_URL)
        };
    }

    const normalizedRequestOrigin =
        normalizeOrigin(requestOrigin);

    return {
        allowed: allowedOrigins.has(normalizedRequestOrigin),
        origin: normalizedRequestOrigin
    };
}

function jsonResponse(statusCode, body, allowedOrigin = null) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Headers':
            'Content-Type, Authorization',
        'Access-Control-Allow-Methods':
            'POST, OPTIONS',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Origin'
    };

    if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] =
            allowedOrigin;
    }

    return {
        statusCode,
        headers,
        body: JSON.stringify(body)
    };
}

function getBearerToken(event) {
    const authorization =
        event.headers?.authorization ||
        event.headers?.Authorization ||
        '';

    const match = authorization.match(
        /^Bearer\s+(.+)$/i
    );

    return match ? match[1].trim() : null;
}

function isUuid(value) {
    return (
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            value
        )
    );
}

async function readJson(response) {
    const responseText = await response.text();

    if (!responseText) {
        return {};
    }

    try {
        return JSON.parse(responseText);
    } catch {
        return {
            message: responseText
        };
    }
}

async function markPaymentFailed(paymentId) {
    if (!paymentId) {
        return;
    }

    try {
        await fetch(
            `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/payments?id=eq.${encodeURIComponent(
                paymentId
            )}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization:
                        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    Prefer: 'return=minimal'
                },
                body: JSON.stringify({
                    payment_status: 'failed'
                })
            }
        );
    } catch (error) {
        console.error(
            'Unable to mark payment as failed:',
            error.message
        );
    }
}

exports.handler = async (event) => {
    const cors = resolveCorsOrigin(event);

    if (!cors.allowed) {
        return jsonResponse(403, {
            error: 'Request origin is not allowed.'
        });
    }

    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(
            200,
            { message: 'OK' },
            cors.origin
        );
    }

    if (event.httpMethod !== 'POST') {
        return jsonResponse(
            405,
            { error: 'Method not allowed.' },
            cors.origin
        );
    }

    try {
        if (
            !PAYSTACK_SECRET_KEY ||
            !SUPABASE_URL ||
            !SUPABASE_SERVICE_ROLE_KEY ||
            !SITE_URL
        ) {
            return jsonResponse(
                500,
                {
                    error:
                        'Payment server is not fully configured.'
                },
                cors.origin
            );
        }

        /*
          Authenticate the tenant using their Supabase access token.
          The browser cannot choose the tenant ID or email.
        */
        const accessToken = getBearerToken(event);

        if (!accessToken) {
            return jsonResponse(
                401,
                {
                    error:
                        'You must be logged in to make a payment.'
                },
                cors.origin
            );
        }

        const baseSupabaseUrl =
            SUPABASE_URL.replace(/\/+$/, '');

        const authResponse = await fetch(
            `${baseSupabaseUrl}/auth/v1/user`,
            {
                method: 'GET',
                headers: {
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const authenticatedUser =
            await readJson(authResponse);

        if (
            !authResponse.ok ||
            !authenticatedUser?.id
        ) {
            return jsonResponse(
                401,
                {
                    error:
                        'Your login session is invalid or has expired. Please log in again.'
                },
                cors.origin
            );
        }

        if (!authenticatedUser.email) {
            return jsonResponse(
                400,
                {
                    error:
                        'Your account needs a valid email address before using Paystack.'
                },
                cors.origin
            );
        }

        let body;

        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            return jsonResponse(
                400,
                {
                    error: 'Invalid request data.'
                },
                cors.origin
            );
        }

        /*
          These are the only payment details accepted from the
          browser. The tenant, landlord, amount, currency and title
          will be determined by trusted server/database code.
        */
        const propertyId =
            typeof body.property_id === 'string'
                ? body.property_id.trim()
                : '';

        const negotiationId =
            typeof body.negotiation_id === 'string' &&
            body.negotiation_id.trim()
                ? body.negotiation_id.trim()
                : null;

        if (!isUuid(propertyId)) {
            return jsonResponse(
                400,
                {
                    error:
                        'A valid property ID is required.'
                },
                cors.origin
            );
        }

        if (
            negotiationId !== null &&
            !isUuid(negotiationId)
        ) {
            return jsonResponse(
                400,
                {
                    error:
                        'The negotiation ID is invalid.'
                },
                cors.origin
            );
        }

        /*
          Generate the payment reference on the trusted server.
        */
        const paymentReference =
            `RH-${Date.now()}-${crypto
                .randomBytes(6)
                .toString('hex')}`;

        /*
          Ask the protected database function to verify:
          - the tenant;
          - the property;
          - the landlord;
          - property availability;
          - negotiation ownership and acceptance;
          - the genuine amount.
        */
        const securePaymentResponse = await fetch(
            `${baseSupabaseUrl}/rest/v1/rpc/create_secure_pending_payment`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization:
                        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    p_tenant_id: authenticatedUser.id,
                    p_property_id: propertyId,
                    p_negotiation_id: negotiationId,
                    p_payment_reference:
                        paymentReference
                })
            }
        );

        const securePaymentResult =
            await readJson(securePaymentResponse);

        if (!securePaymentResponse.ok) {
            console.error(
                'Secure payment creation failed:',
                securePaymentResult
            );

            return jsonResponse(
                400,
                {
                    error:
                        securePaymentResult?.message ||
                        'The payment could not be created.'
                },
                cors.origin
            );
        }

        const payment = Array.isArray(
            securePaymentResult
        )
            ? securePaymentResult[0]
            : securePaymentResult;

        if (!payment?.payment_id) {
            return jsonResponse(
                500,
                {
                    error:
                        'The payment server returned an invalid payment record.'
                },
                cors.origin
            );
        }

        /*
          Defence-in-depth checks before contacting Paystack.
        */
        if (
            payment.tenant_id !==
                authenticatedUser.id ||
            payment.property_id !== propertyId ||
            payment.payment_reference !==
                paymentReference ||
            String(payment.currency).toUpperCase() !==
                'GHS' ||
            String(payment.payment_status).toLowerCase() !==
                'pending'
        ) {
            await markPaymentFailed(
                payment.payment_id
            );

            return jsonResponse(
                500,
                {
                    error:
                        'The verified payment details are inconsistent.'
                },
                cors.origin
            );
        }

        const verifiedAmount =
            Number(payment.amount);

        const amountInPesewas = Math.round(
            verifiedAmount * 100
        );

        if (
            !Number.isFinite(verifiedAmount) ||
            !Number.isSafeInteger(amountInPesewas) ||
            amountInPesewas <= 0
        ) {
            await markPaymentFailed(
                payment.payment_id
            );

            return jsonResponse(
                500,
                {
                    error:
                        'The verified payment amount is invalid.'
                },
                cors.origin
            );
        }

        const callbackUrl = new URL(
            '/payment-callback.html',
            SITE_URL
        );

        callbackUrl.searchParams.set(
            'reference',
            paymentReference
        );

        /*
          Initialize Paystack using only server-verified values.
        */
        const paystackResponse = await fetch(
            'https://api.paystack.co/transaction/initialize',
            {
                method: 'POST',
                headers: {
                    Authorization:
                        `Bearer ${PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: authenticatedUser.email,
                    amount: amountInPesewas,
                    currency: 'GHS',
                    reference: paymentReference,
                    callback_url:
                        callbackUrl.toString(),
                    metadata: {
                        payment_id:
                            payment.payment_id,
                        tenant_id:
                            payment.tenant_id,
                        landlord_id:
                            payment.landlord_id,
                        property_id:
                            payment.property_id,
                        negotiation_id:
                            payment.negotiation_id ||
                            null
                    }
                })
            }
        );

        const paystackData =
            await readJson(paystackResponse);

        if (
            !paystackResponse.ok ||
            !paystackData?.status ||
            !paystackData?.data?.authorization_url
        ) {
            await markPaymentFailed(
                payment.payment_id
            );

            console.error(
                'Paystack initialization failed:',
                paystackData
            );

            return jsonResponse(
                502,
                {
                    error:
                        paystackData?.message ||
                        'Paystack could not initialize the payment.'
                },
                cors.origin
            );
        }

        /*
          Return only the values required by the frontend.
          Do not return the service key or sensitive payment data.
        */
        return jsonResponse(
            200,
            {
                message:
                    'Payment initialized successfully.',
                payment_id: payment.payment_id,
                reference: paymentReference,
                amount: verifiedAmount,
                currency: 'GHS',
                property_title:
                    payment.property_title,
                authorization_url:
                    paystackData.data
                        .authorization_url
            },
            cors.origin
        );
    } catch (error) {
        console.error(
            'Payment initialization error:',
            error
        );

        return jsonResponse(
            500,
            {
                error:
                    'Payment initialization failed. Please try again.'
            },
            cors.origin
        );
    }
};