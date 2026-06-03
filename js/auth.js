let currentMode = 'login';
let pendingRedirectUrl = null;

// ==========================================
// CUSTOM DIALOG LOGIC
// ==========================================
function showCustomDialog(title, message, redirectUrl = null) {
    const dialogTitle = document.getElementById('dialog-title');
    const dialogMessage = document.getElementById('dialog-message');
    const customDialog = document.getElementById('custom-dialog');

    if (dialogTitle) dialogTitle.innerText = title;
    if (dialogMessage) dialogMessage.innerText = message;
    if (customDialog) customDialog.style.display = 'flex';

    pendingRedirectUrl = redirectUrl;
}

function closeCustomDialog() {
    const customDialog = document.getElementById('custom-dialog');

    if (customDialog) {
        customDialog.style.display = 'none';
    }

    if (pendingRedirectUrl) {
        window.location.href = pendingRedirectUrl;
    }
}

window.closeCustomDialog = closeCustomDialog;

// ==========================================
// ROLE REDIRECT HELPER
// ==========================================
function getDashboardByRole(role) {
    if (role === 'Admin') {
        return 'admin-dashboard.html';
    }

    if (role === 'Landlord') {
        return 'landlord-dashboard.html';
    }

    return 'tenant-dashboard.html';
}

// ==========================================
// AUTH MODAL LOGIC
// ==========================================
function openModal(mode) {
    currentMode = mode;

    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('modal-title');
    const signupFields = document.getElementById('signup-fields');
    const submitBtn = document.getElementById('submit-auth-btn');
    const errorDisplay = document.getElementById('auth-error');

    const fullNameInput = document.getElementById('full-name');
    const securityAnswerInput = document.getElementById('security-answer');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const confirmPasswordGroup = document.getElementById('confirm-password-group');

    const googleLoginOptions = document.getElementById('google-login-options');
    const googleSignupOptions = document.getElementById('google-signup-options');

    if (errorDisplay) {
        errorDisplay.style.display = 'none';
        errorDisplay.innerText = '';
    }

    if (modal) {
        modal.style.display = 'flex';
    }

    if (mode === 'signup') {
        if (title) title.innerText = 'Create Your RentHaven Account';
        if (signupFields) signupFields.style.display = 'block';
        if (submitBtn) submitBtn.innerText = 'Create Account';

        if (fullNameInput) fullNameInput.required = true;
        if (securityAnswerInput) securityAnswerInput.required = true;

        if (confirmPasswordGroup) confirmPasswordGroup.style.display = 'block';
        if (confirmPasswordInput) confirmPasswordInput.required = true;

        if (googleLoginOptions) googleLoginOptions.style.display = 'none';
        if (googleSignupOptions) googleSignupOptions.style.display = 'flex';
    } else {
        if (title) title.innerText = 'Welcome Back';
        if (signupFields) signupFields.style.display = 'none';
        if (submitBtn) submitBtn.innerText = 'Log In';

        if (fullNameInput) fullNameInput.required = false;
        if (securityAnswerInput) securityAnswerInput.required = false;

        if (confirmPasswordGroup) confirmPasswordGroup.style.display = 'none';
        if (confirmPasswordInput) {
            confirmPasswordInput.required = false;
            confirmPasswordInput.value = '';
        }

        if (googleLoginOptions) googleLoginOptions.style.display = 'flex';
        if (googleSignupOptions) googleSignupOptions.style.display = 'none';
    }
}

function closeModal() {
    const modal = document.getElementById('auth-modal');
    const authForm = document.getElementById('auth-form');
    const errorDisplay = document.getElementById('auth-error');

    if (modal) {
        modal.style.display = 'none';
    }

    if (authForm) {
        authForm.reset();
    }

    if (errorDisplay) {
        errorDisplay.style.display = 'none';
        errorDisplay.innerText = '';
    }
}

window.openModal = openModal;
window.closeModal = closeModal;

// ==========================================
// GOOGLE AUTH HELPERS
// ==========================================
function getAppBaseUrl() {
    return `${window.location.origin}/rental-platform/`;
}

function getIndexRedirectUrl() {
    return `${getAppBaseUrl()}index.html`;
}

function getFullNameFromGoogleUser(user) {
    return (
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email?.split('@')[0] ||
        'RentHaven User'
    );
}

async function redirectUserByRole(role) {
    window.location.href = getDashboardByRole(role);
}

function isOAuthRedirectBack() {
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));

    return (
        urlParams.has('code') ||
        urlParams.has('error') ||
        hashParams.has('access_token') ||
        hashParams.has('refresh_token') ||
        hashParams.has('error')
    );
}

async function processOAuthSessionIfPresent() {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();

    if (sessionError || !sessionData?.session?.user) {
        return;
    }

    const user = sessionData.session.user;

    const { data: existingProfile, error: profileLookupError } = await supabaseClient
        .from('users')
        .select('id, role, full_name, is_active, email')
        .eq('id', user.id)
        .maybeSingle();

    if (profileLookupError) {
        console.error('Google profile lookup error:', profileLookupError.message);
        return;
    }

    if (existingProfile?.is_active === false) {
        await supabaseClient.auth.signOut();

        showCustomDialog(
            'Account Deactivated',
            'This account has been deactivated by the system administrator. Please contact support.'
        );

        return;
    }

    if (existingProfile?.role) {
        if (!existingProfile.email && user.email) {
            await supabaseClient
                .from('users')
                .update({ email: user.email })
                .eq('id', user.id);
        }

        localStorage.removeItem('renthaven_pending_google_role');
        await redirectUserByRole(existingProfile.role);
        return;
    }

    const pendingRole = localStorage.getItem('renthaven_pending_google_role');

    if (!pendingRole) {
        await supabaseClient.auth.signOut();

        showCustomDialog(
            'Choose Account Type',
            'Your Google account is not yet linked to a RentHaven profile. Please click Sign Up and choose Google as Tenant or Landlord.'
        );

        return;
    }

    if (!['Tenant', 'Landlord'].includes(pendingRole)) {
        localStorage.removeItem('renthaven_pending_google_role');
        await supabaseClient.auth.signOut();

        showCustomDialog(
            'Invalid Account Type',
            'Please try signing up with Google again and choose either Tenant or Landlord.'
        );

        return;
    }

    const fullName = getFullNameFromGoogleUser(user);

    const { error: insertError } = await supabaseClient
        .from('users')
        .insert([{
            id: user.id,
            role: pendingRole,
            full_name: fullName,
            email: user.email,
            is_active: true
        }]);

    if (insertError) {
        console.error('Google profile creation error:', insertError.message);

        showCustomDialog(
            'Profile Setup Failed',
            insertError.message || 'Unable to create your profile after Google sign in.'
        );

        return;
    }

    localStorage.removeItem('renthaven_pending_google_role');

    await redirectUserByRole(pendingRole);
}

async function startGoogleAuth(role = null) {
    const errorDisplay = document.getElementById('auth-error');

    if (errorDisplay) {
        errorDisplay.style.display = 'none';
        errorDisplay.innerText = '';
    }

    try {
        if (role) {
            localStorage.setItem('renthaven_pending_google_role', role);
        } else {
            localStorage.removeItem('renthaven_pending_google_role');
        }

        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: getIndexRedirectUrl(),
                queryParams: {
                    access_type: 'offline',
                    prompt: 'select_account'
                }
            }
        });

        if (error) throw error;
    } catch (err) {
        if (errorDisplay) {
            errorDisplay.innerText = err.message || 'Google authentication failed.';
            errorDisplay.style.display = 'block';
        }
    }
}

// ==========================================
// AUTH FORM SUBMISSION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    if (isOAuthRedirectBack()) {
        await processOAuthSessionIfPresent();
    }

    const authForm = document.getElementById('auth-form');
    const errorDisplay = document.getElementById('auth-error');

    const googleLoginBtn = document.getElementById('google-login-btn');
    const googleTenantBtn = document.getElementById('google-tenant-btn');
    const googleLandlordBtn = document.getElementById('google-landlord-btn');

    googleLoginBtn?.addEventListener('click', () => startGoogleAuth(null));
    googleTenantBtn?.addEventListener('click', () => startGoogleAuth('Tenant'));
    googleLandlordBtn?.addEventListener('click', () => startGoogleAuth('Landlord'));

    if (!authForm) return;

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (errorDisplay) {
            errorDisplay.style.display = 'none';
            errorDisplay.innerText = '';
        }

        const email = document.getElementById('email')?.value.trim();
        const password = document.getElementById('password')?.value;
        const confirmPassword = document.getElementById('confirm-password')?.value;

        const submitBtn = document.getElementById('submit-auth-btn');
        const originalBtnText = submitBtn ? submitBtn.innerText : 'Continue';

        if (!email || !password) {
            if (errorDisplay) {
                errorDisplay.innerText = 'Please enter your email address and password.';
                errorDisplay.style.display = 'block';
            }
            return;
        }

        if (password.length < 6) {
            if (errorDisplay) {
                errorDisplay.innerText = 'Password must be at least 6 characters.';
                errorDisplay.style.display = 'block';
            }
            return;
        }

        if (currentMode === 'signup') {
            if (!confirmPassword) {
                if (errorDisplay) {
                    errorDisplay.innerText = 'Please confirm your password.';
                    errorDisplay.style.display = 'block';
                }
                return;
            }

            if (password !== confirmPassword) {
                if (errorDisplay) {
                    errorDisplay.innerText = 'The two passwords do not match. Please check and try again.';
                    errorDisplay.style.display = 'block';
                }
                return;
            }
        }

        if (submitBtn) {
            submitBtn.innerText = currentMode === 'signup' ? 'Creating Account...' : 'Logging In...';
            submitBtn.disabled = true;
        }

        try {
            if (currentMode === 'signup') {
                const fullName = document.getElementById('full-name')?.value.trim();
                const role = document.getElementById('user-role')?.value;
                const question = document.getElementById('security-question')?.value;
                const answer = document.getElementById('security-answer')?.value.trim();

                if (!fullName || !answer) {
                    throw new Error('Please complete all required signup fields.');
                }

                if (!role) {
                    throw new Error('Please select an account type.');
                }

                const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                    email: email,
                    password: password
                });

                if (authError) throw authError;

                if (authData.user) {
                    const { error: userError } = await supabaseClient
                        .from('users')
                        .insert([{
                            id: authData.user.id,
                            role: role,
                            full_name: fullName,
                            email: email,
                            is_active: true
                        }]);

                    if (userError) throw userError;

                    const { error: secError } = await supabaseClient
                        .from('user_security')
                        .insert([{
                            user_id: authData.user.id,
                            question: question,
                            answer: answer.toLowerCase()
                        }]);

                    if (secError) {
                        console.warn('Security question could not be saved:', secError.message);
                    }
                }

                closeModal();

                const redirectPath = getDashboardByRole(role);

                showCustomDialog(
                    'Account Created',
                    'Your RentHaven Ghana account has been created successfully.',
                    redirectPath
                );
            } else {
                const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (authError) throw authError;

                const { data: userData, error: dbError } = await supabaseClient
                    .from('users')
                    .select('role, is_active, email')
                    .eq('id', authData.user.id)
                    .single();

                if (dbError) throw dbError;

                if (userData?.is_active === false) {
                    await supabaseClient.auth.signOut();

                    throw new Error('This account has been deactivated by the system administrator.');
                }

                if (!userData.email && email) {
                    await supabaseClient
                        .from('users')
                        .update({ email: email })
                        .eq('id', authData.user.id);
                }

                closeModal();

                const redirectPath = getDashboardByRole(userData.role);

                showCustomDialog(
                    'Welcome Back',
                    'You have logged in to RentHaven Ghana successfully.',
                    redirectPath
                );
            }
        } catch (err) {
            if (errorDisplay) {
                errorDisplay.innerText = err.message || 'Authentication failed. Please try again.';
                errorDisplay.style.display = 'block';
            }
        } finally {
            if (submitBtn) {
                submitBtn.innerText = originalBtnText;
                submitBtn.disabled = false;
            }
        }
    });
});