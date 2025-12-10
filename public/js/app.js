const API_URL = "https://eyegradetracker.onrender.com/api";

const SUPABASE_URL = "https://rkztzzvfhgwztdjxhgbh.supabase.co"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrenR6enZmaGd3enRkanhoZ2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNzc4MDcsImV4cCI6MjA4MDY1MzgwN30.R83VEpHmOd_bkfm7-BNCDzTkYRzjb86_2KntzvVEpMo"; 

// Initialize Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth Headers Helper
function getHeaders() {
    const user = JSON.parse(localStorage.getItem('eye_user'));
    if (!user) return {};
    return {
        'Content-Type': 'application/json',
        'user-id': user.id,
        'user-email': user.email
    };
}

// Global Auth Check
function checkAuth() {
    const user = JSON.parse(localStorage.getItem('eye_user'));
    const path = window.location.pathname;
    
    // 1. Redirect to login if NOT authenticated and trying to access inside pages
    if (!user && !path.includes('index.html') && path !== '/' && path !== '') {
        window.location.href = 'index.html';
    }
}

// LOGOUT FUNCTION
async function logout() {
    localStorage.removeItem('eye_user');

    try {
        await supabase.auth.signOut();
    } catch (e) {
        console.log("Supabase logout error (ignored):", e);
    }

    window.location.replace('index.html');
}