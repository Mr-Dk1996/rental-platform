const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        body: JSON.stringify(body)
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return jsonResponse(200, { message: 'OK' });
    }

    try {
        if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            return jsonResponse(500, {
                error: 'Payment verification server is not fully configured.'
            });
        }

        let body = {};

        try {
            body = JSON.parse(event.body || '{}');
        } catch {
            body = {};
        }

        const reference =
            event.queryStringParameters?.reference ||
            body.reference;

        if (!reference) {
            return jsonResponse(400, {
                error: 'Payment reference is required.'
            });
        }

        const verifyResponse = await fetch(
            `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );

        const verifyData = await verifyResponse.json();

        if (!verifyResponse.ok || !verifyData.status) {
            return jsonResponse(400, {
                error: 'Unable to verify payment.',
                details: verifyData
            });
        }

        const transaction = verifyData.data;
        const isPaid = transaction && transaction.status === 'success';

        const updatePayload = {
            payment_status: isPaid ? 'paid' : 'failed',
            payment_channel: transaction?.channel || null,
            receipt_url: transaction?.receipt_url || null,
            paid_at: isPaid ? new Date(transaction.paid_at || transaction.created_at || Date.now()).toISOString() : null
        };

        const updatePaymentResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/payments?payment_reference=eq.${encodeURIComponent(reference)}`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    Prefer: 'return=representation'
                },
                body: JSON.stringify(updatePayload)
            }
        );

        const updatedPayment = await updatePaymentResponse.json();

        if (!updatePaymentResponse.ok || !updatedPayment?.length) {
            return jsonResponse(updatePaymentResponse.status, {
                error: 'Unable to update payment record.',
                details: updatedPayment
            });
        }

        let ledgerBlock = null;

        if (isPaid) {
            const ledgerResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_payment_ledger_block`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                    p_payment_id: updatedPayment[0].id
                })
            });

            ledgerBlock = await ledgerResponse.json();

            if (!ledgerResponse.ok) {
                return jsonResponse(500, {
                    error: 'Payment verified, but blockchain ledger block creation failed.',
                    payment: updatedPayment[0],
                    ledger_error: ledgerBlock
                });
            }
        }

        return jsonResponse(200, {
            message: isPaid ? 'Payment verified successfully.' : 'Payment was not successful.',
            status: isPaid ? 'paid' : 'failed',
            payment: updatedPayment[0],
            ledger_block_id: ledgerBlock
        });
    } catch (error) {
        return jsonResponse(500, {
            error: 'Payment verification failed.',
            details: error.message
        });
    }
};