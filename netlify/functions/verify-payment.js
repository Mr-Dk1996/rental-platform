const PAYSTACK_SECRET_KEY =
    process.env.PAYSTACK_SECRET_KEY;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE_URL =
    process.env.SITE_URL;

const ALLOWED_ORIGINS =
    process.env.ALLOWED_ORIGINS || '';

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
        .map((origin) =>
            normalizeOrigin(origin.trim())
        )
        .filter(Boolean)
        .forEach((origin) =>
            origins.add(origin)
        );

    return origins;
}

function resolveCorsOrigin(event) {
    const allowedOrigins =
        getAllowedOrigins();

    const requestOrigin =
        event.headers?.origin ||
        event.headers?.Origin ||
        null;

    if (!requestOrigin) {
        return {
            allowed: true,
            origin: normalizeOrigin(SITE_URL)
        };
    }

    const normalizedRequestOrigin =
        normalizeOrigin(requestOrigin);

    return {
        allowed: allowedOrigins.has(
            normalizedRequestOrigin
        ),
        origin: normalizedRequestOrigin
    };
}

function jsonResponse(
    statusCode,
    body,
    allowedOrigin = null
) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Headers':
            'Content-Type, Authorization',
        'Access-Control-Allow-Methods':
            'GET, POST, OPTIONS',
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

    return match
        ? match[1].trim()
        : null;
}

function isValidReference(value) {
    return (
        typeof value === 'string' &&
        value.length >= 1 &&
        value.length <= 100 &&
        /^[A-Za-z0-9.=-]+$/.test(value)
    );
}

async function readJson(response) {
    const responseText =
        await response.text();

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

function parseMetadata(value) {
    if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
    ) {
        return value;
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);

            if (
                parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed)
            ) {
                return parsed;
            }
        } catch {
            return {};
        }
    }

    return {};
}

function valuesMatch(first, second) {
    return String(first || '') ===
        String(second || '');
}

function toIsoDate(value) {
    const parsedDate = new Date(
        value || Date.now()
    );

    if (
        Number.isNaN(
            parsedDate.getTime()
        )
    ) {
        return new Date().toISOString();
    }

    return parsedDate.toISOString();
}

async function getPaymentById(
    baseSupabaseUrl,
    paymentId
) {
    const response = await fetch(
        `${baseSupabaseUrl}/rest/v1/payments` +
        `?select=id,tenant_id,landlord_id,property_id,negotiation_id,amount,currency,payment_status,payment_reference,payment_channel,receipt_url,paid_at` +
        `&id=eq.${encodeURIComponent(paymentId)}` +
        `&limit=1`,
        {
            method: 'GET',
            headers: {
                apikey:
                    SUPABASE_SERVICE_ROLE_KEY,
                Authorization:
                    `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
        }
    );

    const result =
        await readJson(response);

    if (
        !response.ok ||
        !Array.isArray(result)
    ) {
        return null;
    }

    return result[0] || null;
}

exports.handler = async (event) => {
    const cors =
        resolveCorsOrigin(event);

    if (!cors.allowed) {
        return jsonResponse(403, {
            error:
                'Request origin is not allowed.'
        });
    }

    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(
            200,
            { message: 'OK' },
            cors.origin
        );
    }

    if (
        event.httpMethod !== 'GET' &&
        event.httpMethod !== 'POST'
    ) {
        return jsonResponse(
            405,
            {
                error: 'Method not allowed.'
            },
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
                        'Payment verification server is not fully configured.'
                },
                cors.origin
            );
        }

        /*
          Authenticate the current Supabase user.
        */
        const accessToken =
            getBearerToken(event);

        if (!accessToken) {
            return jsonResponse(
                401,
                {
                    error:
                        'You must be logged in to verify this payment.'
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
                    apikey:
                        SUPABASE_SERVICE_ROLE_KEY,
                    Authorization:
                        `Bearer ${accessToken}`
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

        /*
          Read the payment reference.
        */
        let body = {};

        if (
            event.httpMethod === 'POST' &&
            event.body
        ) {
            try {
                body = JSON.parse(event.body);
            } catch {
                return jsonResponse(
                    400,
                    {
                        error:
                            'Invalid request data.'
                    },
                    cors.origin
                );
            }
        }

        const referenceValue =
            event.queryStringParameters
                ?.reference ||
            body.reference ||
            '';

        const reference =
            typeof referenceValue === 'string'
                ? referenceValue.trim()
                : '';

        if (!isValidReference(reference)) {
            return jsonResponse(
                400,
                {
                    error:
                        'A valid payment reference is required.'
                },
                cors.origin
            );
        }

        /*
          Retrieve only a payment belonging to the
          authenticated tenant.
        */
        const paymentLookupResponse =
            await fetch(
                `${baseSupabaseUrl}/rest/v1/payments` +
                `?select=id,tenant_id,landlord_id,property_id,negotiation_id,amount,currency,payment_status,payment_reference,payment_channel,receipt_url,paid_at` +
                `&payment_reference=eq.${encodeURIComponent(reference)}` +
                `&tenant_id=eq.${encodeURIComponent(authenticatedUser.id)}` +
                `&limit=1`,
                {
                    method: 'GET',
                    headers: {
                        apikey:
                            SUPABASE_SERVICE_ROLE_KEY,
                        Authorization:
                            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                    }
                }
            );

        const paymentLookupResult =
            await readJson(
                paymentLookupResponse
            );

        if (
            !paymentLookupResponse.ok ||
            !Array.isArray(
                paymentLookupResult
            )
        ) {
            console.error(
                'Payment lookup failed:',
                paymentLookupResult
            );

            return jsonResponse(
                500,
                {
                    error:
                        'Unable to retrieve the payment record.'
                },
                cors.origin
            );
        }

        const payment =
            paymentLookupResult[0];

        if (!payment) {
            return jsonResponse(
                404,
                {
                    error:
                        'Payment not found or you do not have permission to verify it.'
                },
                cors.origin
            );
        }

        const paymentAmount =
            Number(payment.amount);

        const expectedAmountInPesewas =
            Math.round(paymentAmount * 100);

        if (
            !Number.isFinite(paymentAmount) ||
            !Number.isSafeInteger(
                expectedAmountInPesewas
            ) ||
            expectedAmountInPesewas <= 0
        ) {
            return jsonResponse(
                500,
                {
                    error:
                        'The stored payment amount is invalid.'
                },
                cors.origin
            );
        }

        /*
          Independently verify the transaction
          directly with Paystack.
        */
        const verifyResponse = await fetch(
            `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
            {
                method: 'GET',
                headers: {
                    Authorization:
                        `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );

        const verifyData =
            await readJson(verifyResponse);

        if (
            !verifyResponse.ok ||
            !verifyData?.status ||
            !verifyData?.data
        ) {
            console.error(
                'Paystack verification failed:',
                verifyData
            );

            return jsonResponse(
                502,
                {
                    error:
                        verifyData?.message ||
                        'Paystack could not verify this transaction.'
                },
                cors.origin
            );
        }

        const transaction =
            verifyData.data;

        /*
          Do not mark a transaction as paid until
          Paystack explicitly returns success.
        */
        if (
            String(
                transaction.status || ''
            ).toLowerCase() !== 'success'
        ) {
            return jsonResponse(
                409,
                {
                    error:
                        'This payment has not been completed successfully.',
                    status:
                        transaction.status ||
                        'pending'
                },
                cors.origin
            );
        }

        const metadata =
            parseMetadata(
                transaction.metadata
            );

        const verifiedPaystackAmount =
            Number(transaction.amount);

        const verifiedCurrency =
            String(
                transaction.currency || ''
            ).toUpperCase();

        /*
          Compare every trusted transaction field.
        */
        const validationChecks = {
            reference:
                transaction.reference ===
                payment.payment_reference,

            amount:
                Number.isSafeInteger(
                    verifiedPaystackAmount
                ) &&
                verifiedPaystackAmount ===
                    expectedAmountInPesewas,

            currency:
                verifiedCurrency ===
                    String(
                        payment.currency || ''
                    ).toUpperCase() &&
                verifiedCurrency === 'GHS',

            payment_id:
                valuesMatch(
                    metadata.payment_id,
                    payment.id
                ),

            tenant_id:
                valuesMatch(
                    metadata.tenant_id,
                    payment.tenant_id
                ) &&
                valuesMatch(
                    payment.tenant_id,
                    authenticatedUser.id
                ),

            landlord_id:
                valuesMatch(
                    metadata.landlord_id,
                    payment.landlord_id
                ),

            property_id:
                valuesMatch(
                    metadata.property_id,
                    payment.property_id
                ),

            negotiation_id:
                valuesMatch(
                    metadata.negotiation_id,
                    payment.negotiation_id
                )
        };

        const failedChecks =
            Object.entries(validationChecks)
                .filter(([, passed]) => !passed)
                .map(([field]) => field);

        if (failedChecks.length > 0) {
            console.error(
                'Payment verification mismatch:',
                {
                    paymentId: payment.id,
                    failedChecks
                }
            );

            return jsonResponse(
                409,
                {
                    error:
                        'The verified Paystack transaction does not match the expected payment details.'
                },
                cors.origin
            );
        }

        /*
          Never downgrade an already-paid payment.
          Otherwise, update it only after all checks pass.
        */
        let finalPayment = payment;

        if (
            String(
                payment.payment_status || ''
            ).toLowerCase() !== 'paid'
        ) {
            const updatePayload = {
                payment_status: 'paid',
                payment_channel:
                    transaction.channel ||
                    null,
                receipt_url:
                    transaction.receipt_url ||
                    null,
                paid_at:
                    toIsoDate(
                        transaction.paid_at ||
                        transaction.created_at
                    )
            };

            const updateResponse =
                await fetch(
                    `${baseSupabaseUrl}/rest/v1/payments` +
                    `?id=eq.${encodeURIComponent(payment.id)}` +
                    `&payment_status=neq.paid`,
                    {
                        method: 'PATCH',
                        headers: {
                            'Content-Type':
                                'application/json',
                            apikey:
                                SUPABASE_SERVICE_ROLE_KEY,
                            Authorization:
                                `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                            Prefer:
                                'return=representation'
                        },
                        body: JSON.stringify(
                            updatePayload
                        )
                    }
                );

            const updateResult =
                await readJson(updateResponse);

            if (!updateResponse.ok) {
                console.error(
                    'Payment update failed:',
                    updateResult
                );

                return jsonResponse(
                    500,
                    {
                        error:
                            'The payment was verified, but the payment record could not be updated.'
                    },
                    cors.origin
                );
            }

            if (
                Array.isArray(updateResult) &&
                updateResult[0]
            ) {
                finalPayment =
                    updateResult[0];
            } else {
                /*
                  The webhook may have marked it paid
                  at the same time. Retrieve the final state.
                */
                finalPayment =
                    await getPaymentById(
                        baseSupabaseUrl,
                        payment.id
                    );
            }
        }

        if (
            !finalPayment ||
            String(
                finalPayment.payment_status ||
                ''
            ).toLowerCase() !== 'paid'
        ) {
            return jsonResponse(
                500,
                {
                    error:
                        'The transaction was verified, but its final payment status could not be confirmed.'
                },
                cors.origin
            );
        }

        /*
          The database function is race-safe and returns
          the existing ledger block when called repeatedly.
        */
        const ledgerResponse = await fetch(
            `${baseSupabaseUrl}/rest/v1/rpc/create_payment_ledger_block`,
            {
                method: 'POST',
                headers: {
                    'Content-Type':
                        'application/json',
                    apikey:
                        SUPABASE_SERVICE_ROLE_KEY,
                    Authorization:
                        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    p_payment_id:
                        finalPayment.id
                })
            }
        );

        const ledgerBlock =
            await readJson(ledgerResponse);

        if (!ledgerResponse.ok) {
            console.error(
                'Ledger creation failed:',
                ledgerBlock
            );

            return jsonResponse(
                500,
                {
                    error:
                        'The payment was recorded successfully, but the secure ledger could not be updated.',
                    payment_status: 'paid'
                },
                cors.origin
            );
        }

        return jsonResponse(
            200,
            {
                message:
                    'Payment verified successfully.',
                status: 'paid',
                payment_id:
                    finalPayment.id,
                reference:
                    finalPayment
                        .payment_reference,
                amount:
                    Number(
                        finalPayment.amount
                    ),
                currency:
                    finalPayment.currency,
                paid_at:
                    finalPayment.paid_at,
                ledger_block_id:
                    ledgerBlock
            },
            cors.origin
        );
    } catch (error) {
        console.error(
            'Payment verification error:',
            error
        );

        return jsonResponse(
            500,
            {
                error:
                    'Payment verification failed. Please try again.'
            },
            cors.origin
        );
    }
};