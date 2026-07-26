const crypto = require('crypto');

const PAYSTACK_SECRET_KEY =
    process.env.PAYSTACK_SECRET_KEY;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        },
        body: JSON.stringify(body)
    };
}

function getHeader(event, headerName) {
    const headers = event.headers || {};
    const expectedName = headerName.toLowerCase();

    const matchingKey = Object.keys(headers).find(
        (key) => key.toLowerCase() === expectedName
    );

    return matchingKey
        ? String(headers[matchingKey] || '').trim()
        : '';
}

function getRawBody(event) {
    if (typeof event.body !== 'string') {
        return null;
    }

    try {
        return Buffer.from(
            event.body,
            event.isBase64Encoded ? 'base64' : 'utf8'
        );
    } catch {
        return null;
    }
}

function hasValidPaystackSignature(
    rawBody,
    receivedSignature
) {
    if (
        !PAYSTACK_SECRET_KEY ||
        !Buffer.isBuffer(rawBody) ||
        !/^[a-fA-F0-9]{128}$/.test(receivedSignature)
    ) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha512', PAYSTACK_SECRET_KEY)
        .update(rawBody)
        .digest();

    const receivedSignatureBuffer =
        Buffer.from(receivedSignature, 'hex');

    return (
        expectedSignature.length ===
            receivedSignatureBuffer.length &&
        crypto.timingSafeEqual(
            expectedSignature,
            receivedSignatureBuffer
        )
    );
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

function hasValue(value) {
    return (
        value !== null &&
        value !== undefined &&
        String(value) !== ''
    );
}

function valuesMatch(first, second) {
    const normalizedFirst =
        first === null || first === undefined
            ? ''
            : String(first);

    const normalizedSecond =
        second === null || second === undefined
            ? ''
            : String(second);

    return normalizedFirst === normalizedSecond;
}

function toIsoDate(value) {
    const parsedDate = new Date(value || Date.now());

    if (Number.isNaN(parsedDate.getTime())) {
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
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization:
                    `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            }
        }
    );

    const result = await readJson(response);

    if (
        !response.ok ||
        !Array.isArray(result)
    ) {
        return null;
    }

    return result[0] || null;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, {
            error: 'Method not allowed.'
        });
    }

    try {
        if (
            !PAYSTACK_SECRET_KEY ||
            !SUPABASE_URL ||
            !SUPABASE_SERVICE_ROLE_KEY
        ) {
            console.error(
                'Webhook server is not fully configured.'
            );

            return jsonResponse(500, {
                error:
                    'Webhook server is not fully configured.'
            });
        }

        /*
          Verify the signature against the exact raw request
          body before parsing or processing the event.
        */
        const rawBody = getRawBody(event);
        const receivedSignature = getHeader(
            event,
            'x-paystack-signature'
        );

        if (
            !rawBody ||
            !hasValidPaystackSignature(
                rawBody,
                receivedSignature
            )
        ) {
            console.warn(
                'Rejected webhook with invalid signature.'
            );

            return jsonResponse(401, {
                error: 'Invalid webhook signature.'
            });
        }

        let webhookEvent;

        try {
            webhookEvent = JSON.parse(
                rawBody.toString('utf8')
            );
        } catch {
            return jsonResponse(400, {
                error: 'Invalid webhook payload.'
            });
        }

        /*
          Acknowledge valid Paystack events that this endpoint
          does not process.
        */
        if (
            webhookEvent?.event !== 'charge.success'
        ) {
            return jsonResponse(200, {
                message: 'Event acknowledged.'
            });
        }

        const eventReferenceValue =
            webhookEvent?.data?.reference;

        const reference =
            typeof eventReferenceValue === 'string'
                ? eventReferenceValue.trim()
                : '';

        if (!isValidReference(reference)) {
            console.error(
                'Signed charge.success event had an invalid reference.'
            );

            return jsonResponse(200, {
                message:
                    'Event acknowledged but not processed.'
            });
        }

        const baseSupabaseUrl =
            SUPABASE_URL.replace(/\/+$/, '');

        /*
          Retrieve the trusted server-created payment record.
        */
        const paymentLookupResponse = await fetch(
            `${baseSupabaseUrl}/rest/v1/payments` +
            `?select=id,tenant_id,landlord_id,property_id,negotiation_id,amount,currency,payment_status,payment_reference,payment_channel,receipt_url,paid_at` +
            `&payment_reference=eq.${encodeURIComponent(reference)}` +
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
            await readJson(paymentLookupResponse);

        if (
            !paymentLookupResponse.ok ||
            !Array.isArray(paymentLookupResult)
        ) {
            console.error(
                'Webhook payment lookup failed:',
                paymentLookupResult
            );

            /*
              Return an error for temporary database failures
              so Paystack can retry the event.
            */
            return jsonResponse(500, {
                error:
                    'Unable to retrieve the payment record.'
            });
        }

        const payment = paymentLookupResult[0];

        if (!payment) {
            /*
              The Paystack account may process unrelated
              transactions. Acknowledge them without changing
              this application's database.
            */
            console.warn(
                'No application payment matched webhook reference:',
                reference
            );

            return jsonResponse(200, {
                message:
                    'Event acknowledged; no matching payment.'
            });
        }

        const paymentAmount = Number(payment.amount);
        const expectedAmountInPesewas =
            Math.round(paymentAmount * 100);

        if (
            !Number.isFinite(paymentAmount) ||
            !Number.isSafeInteger(
                expectedAmountInPesewas
            ) ||
            expectedAmountInPesewas <= 0
        ) {
            console.error(
                'Stored webhook payment amount is invalid:',
                payment.id
            );

            return jsonResponse(200, {
                message:
                    'Event acknowledged but not processed.'
            });
        }

        /*
          Independently verify the transaction with Paystack.
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
                'Webhook Paystack verification failed:',
                verifyData
            );

            return jsonResponse(502, {
                error:
                    'Paystack transaction verification failed.'
            });
        }

        const transaction = verifyData.data;

        if (
            String(
                transaction.status || ''
            ).toLowerCase() !== 'success'
        ) {
            console.error(
                'charge.success verification did not return success:',
                {
                    reference,
                    status: transaction.status
                }
            );

            return jsonResponse(503, {
                error:
                    'Transaction success is not yet confirmed.'
            });
        }

        const metadata =
            parseMetadata(transaction.metadata);

        const verifiedAmount =
            Number(transaction.amount);

        const verifiedCurrency =
            String(
                transaction.currency || ''
            ).toUpperCase();

        /*
          Validate reference, amount, currency and every
          payment ownership field.
        */
        const validationChecks = {
            reference:
                valuesMatch(
                    transaction.reference,
                    payment.payment_reference
                ) &&
                valuesMatch(
                    transaction.reference,
                    reference
                ),

            amount:
                Number.isSafeInteger(
                    verifiedAmount
                ) &&
                verifiedAmount ===
                    expectedAmountInPesewas,

            currency:
                verifiedCurrency === 'GHS' &&
                verifiedCurrency ===
                    String(
                        payment.currency || ''
                    ).toUpperCase(),

            payment_id:
                hasValue(payment.id) &&
                valuesMatch(
                    metadata.payment_id,
                    payment.id
                ),

            tenant_id:
                hasValue(payment.tenant_id) &&
                valuesMatch(
                    metadata.tenant_id,
                    payment.tenant_id
                ),

            landlord_id:
                hasValue(payment.landlord_id) &&
                valuesMatch(
                    metadata.landlord_id,
                    payment.landlord_id
                ),

            property_id:
                hasValue(payment.property_id) &&
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
            /*
              Never update a payment when the verified
              transaction details are inconsistent.
            */
            console.error(
                'Webhook payment validation mismatch:',
                {
                    paymentId: payment.id,
                    reference,
                    failedChecks
                }
            );

            return jsonResponse(200, {
                message:
                    'Event acknowledged but payment details did not match.'
            });
        }

        /*
          The conditional update prevents repeated processing
          and handles callback/webhook races.
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
                    transaction.channel || null,
                receipt_url:
                    transaction.receipt_url || null,
                paid_at:
                    toIsoDate(
                        transaction.paid_at ||
                        transaction.created_at
                    )
            };

            const updateResponse = await fetch(
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
                    'Webhook payment update failed:',
                    updateResult
                );

                return jsonResponse(500, {
                    error:
                        'Verified payment could not be recorded.'
                });
            }

            if (
                Array.isArray(updateResult) &&
                updateResult[0]
            ) {
                finalPayment = updateResult[0];
            } else {
                /*
                  The callback may have marked this payment paid
                  while the webhook was running.
                */
                finalPayment = await getPaymentById(
                    baseSupabaseUrl,
                    payment.id
                );
            }
        }

        if (
            !finalPayment ||
            String(
                finalPayment.payment_status || ''
            ).toLowerCase() !== 'paid'
        ) {
            return jsonResponse(500, {
                error:
                    'The final paid status could not be confirmed.'
            });
        }

        /*
          This function returns the existing ledger block when
          called repeatedly.
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
                'Webhook ledger creation failed:',
                ledgerBlock
            );

            /*
              The payment remains paid. A webhook retry can call
              the idempotent ledger function again.
            */
            return jsonResponse(500, {
                error:
                    'Payment was recorded, but the ledger update failed.'
            });
        }

        /*
          The database trigger creates the landlord
          notification, so no notification is inserted here.
        */
        return jsonResponse(200, {
            message:
                'Webhook processed successfully.'
        });
    } catch (error) {
        console.error(
            'Paystack webhook processing error:',
            error
        );

        return jsonResponse(500, {
            error:
                'Webhook processing failed.'
        });
    }
};