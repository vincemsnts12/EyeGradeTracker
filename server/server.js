require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const cron = require('node-cron'); 
const nodemailer = require('nodemailer'); 

const app = express();
app.use(express.json());

app.use(cors({
    origin: 'https://eye-grade-tracker.vercel.app', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'user-id', 'user-email']
}));

//app.use(express.static(path.join(__dirname, '..', 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- SCHEDULER LOGIC ---
const transporter = nodemailer.createTransport({
    service: 'gmail', // Gamitin ang built-in service setting
    pool: true,       // Keep the connection open (iwas timeout sa handshake)
    maxConnections: 1, // Isa-isang connection lang para hindi ma-flag
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS  
    },
    tls: {
        rejectUnauthorized: false // Iwasan ang SSL certificate errors
    },
    // PINAKA-IMPORTANTE: Force IPv4
    family: 4 
});

// Verify connection configuration
transporter.verify(function (error, success) {
    if (error) {
        console.log('[MAIL SERVER ERROR] Cannot connect to Gmail:', error);
    } else {
        console.log('[MAIL SERVER READY] Server is ready to take our messages');
    }
});


// Helper function to send the reminder email via Nodemailer
async function sendReminderEmail(email, nextCheckupDate) {
    console.log(`[NODEMAILER] Preparing email for: ${email}`);

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Action Required: Your Eye Checkup is Overdue - EyeGradeTracker', 
        
        html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
            <h2 style="color: #000000ff; border-bottom: 2px solid #000000ff; padding-bottom: 10px;">Essential Eye Checkup Reminder</h2>
            
            <p>Dear Valued User,</p>
            
            <p>This is an automated notification from **EyeGradeTracker** regarding your eye care schedule.</p>
            
            <p>Based on your last prescription record, your recommended 6-month checkup was due on or before:</p>
            
            <h3 style="color: #d9534f; background-color: #f9f9f9; padding: 10px; border-radius: 5px; text-align: center;">${nextCheckupDate}</h3>
            
            <p><strong>Maintaining Regular Checkups is Crucial:</strong> Timely visits help detect potential issues early, especially for prolonged screen use common in academic settings.</p>
            
            <p style="margin-top: 20px;">
                We strongly urge you to **schedule an appointment** with your eye care professional as soon as possible.
            </p>
            
            <hr style="border-top: 1px solid #eee; margin: 20px 0;">
            
            <p style="font-size: 0.9em; color: #777;">
                *Please remember to update your prescription details within the EyeGradeTracker application after your visit.*
            </p>
            <p style="font-size: 0.9em; color: #777;">
                Best regards,<br>
                Eye Grade Tracker Admin
            </p>
        </div>
        `,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[NODEMAILER SUCCESS] Message ID: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error(`[NODEMAILER FAILED] Error:`, error.message);
        // Huwag natin i-throw ang error para hindi tumigil ang loop
        return false;
    }
}

async function checkAndSendReminders() {
    console.log(`[DEBUG] 1. Cron Job Started at ${new Date().toISOString()}`);
    
    // Check Database Connection & Data
    const { data: prescriptions, error: dbError } = await supabase
        .from('prescriptions')
        .select('user_id, checkup_date');

    if (dbError) {
        console.error("[DEBUG] ERROR: Database Fetch Failed:", dbError);
        return;
    }

    console.log(`[DEBUG] 2. Found ${prescriptions.length} prescriptions in DB.`);

    if (prescriptions.length === 0) {
        console.log("[DEBUG] Stopping. No prescriptions to check.");
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to midnight

    for (const entry of prescriptions) {
        // Log details of each entry being checked
        const lastCheckupDate = new Date(entry.checkup_date);
        const nextCheckup = new Date(lastCheckupDate);
        nextCheckup.setMonth(lastCheckupDate.getMonth() + 6); 
        nextCheckup.setHours(0, 0, 0, 0);

        console.log(`[DEBUG] Checking User: ${entry.user_id}`);
        console.log(`        - Last Checkup: ${lastCheckupDate.toLocaleDateString()}`);
        console.log(`        - Due Date: ${nextCheckup.toLocaleDateString()}`);
        console.log(`        - Today: ${today.toLocaleDateString()}`);

        if (nextCheckup.getTime() <= today.getTime()) {
            console.log(`        -> STATUS: OVERDUE! Attempting to fetch email...`);
            
            // Fetch Email
            const { data: user, error: userFetchError } = await supabase.auth.admin.getUserById(entry.user_id);
            
            if (userFetchError || !user || !user.user) {
                console.error(`        -> ERROR: User Fetch Failed for ID: ${entry.user_id}`, userFetchError);
                continue;
            }
            
            const userEmail = user.user.email;
            console.log(`        -> Email Found: ${userEmail}. Sending via Nodemailer...`);
            
            // Send Email
            const success = await sendReminderEmail(userEmail, nextCheckup.toLocaleDateString()); 
            
            if (success) console.log(`        -> SUCCESS: Email sent to ${userEmail}`);
            else console.error(`        -> FAILED: Nodemailer failed to send.`);

        } else {
            console.log(`        -> Status: Not yet due.`);
        }
    }
}

// Temporary: Run every minute para ma-test agad
cron.schedule('* * * * *', checkAndSendReminders);

// --- Middleware to Verify User via Header ---
const requireAuth = async (req, res, next) => {
    const userId = req.headers['user-id'];
    const userEmail = req.headers['user-email'];

    if (!userId || !userEmail) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Strict TUP Domain Check
    if (!userEmail.endsWith('@tup.edu.ph')) {
        return res.status(403).json({ error: 'Restricted to @tup.edu.ph accounts only' });
    }

    req.user = { id: userId, email: userEmail };
    next();
};

// --- DATA: Flashcards & Questions ---
const flashcardsPool = [
    { title: "The 'Doomscroll'", content: "Staring at your phone in total darkness confuses your brain and strains eyes. Turn on a lamp!", ref: "Healthline" },
    { title: "Caffeine Twitch", content: "Eyelid twitching? You might have had too much coffee or not enough sleep. Cut back on the espresso.", ref: "Mayo Clinic" },
    { title: "The Knuckle Rub", content: "Rubbing eyes feels good but can break blood vessels and cause dark circles. Resist the urge!", ref: "Cleveland Clinic" },
    { title: "Blink Rate Drop", content: "You normally blink 15x a minute. On a computer, it drops to 5x. That's why your eyes feel gritty.", ref: "UI Health" },
    { title: "The 'Squint'", content: "Squinting doesn't help you focus; it causes headaches. Just zoom in (Ctrl +) or get glasses.", ref: "AllAboutVision" },
    { title: "Morning Crust", content: "That 'sleep' in your eyes is just mucus, oil, and skin cells that didn't wash away because you weren't blinking.", ref: "Utah Eye" },
    { title: "Eye Strain Headache", content: "Pain behind your eyes after work? That's digital eye strain. Take a break, your deadline can wait 5 mins.", ref: "WebMD" },
    { title: "The Carrot Myth", content: "Carrots have Vitamin A, but they won't give you night vision. That was WWII propaganda!", ref: "Smithline" },
    { title: "Reading in Dark", content: "It won't make you go blind, but it causes temporary strain and headache. Turn a light on.", ref: "Harvard Health" },
    { title: "20-20 isn't Perfect", content: "20/20 just means 'average'. Some people have 20/15 or even 20/10 vision (eagle eyes)!", ref: "AOA" },
    { title: "Cloudy Day UV", content: "Clouds don't block UV rays. You still need sunglasses even if it's not 'sunny'.", ref: "NEI" },
    { title: "Tap Water Risk", content: "Never wash contact lenses with tap water. It contains microbes that can cause blindness.", ref: "CDC" },
    { title: "Cheap Sunglasses", content: "Dark glasses without UV protection are worse than none. They dilate pupils, letting MORE UV in.", ref: "AAO" },
    { title: "Makeup Expiry", content: "Mascara expires in 3 months. Using old makeup is a fast track to pink eye.", ref: "AAO" },
    { title: "Contact Naps", content: "Napping in contacts cuts off oxygen to your cornea. Never do it, seriously.", ref: "CDC" },
    { title: "Rebound Redness", content: "Overusing 'red-eye' remover drops can actually make your eyes redder over time.", ref: "AAO" },
    { title: "Brain Power", content: "Your eyes use about 65% of your brainpower—more than any other body part!", ref: "Discovery Eye" },
    { title: "Fast Healers", content: "The cornea is one of the fastest healing tissues. Minor scratches often heal in 48 hours.", ref: "SciAm" },
    { title: "Seeing Worms?", content: "Those floating squiggles are called 'floaters'. They are tiny protein clumps casting shadows on your retina.", ref: "NEI" },
    { title: "Emotional Tears", content: "Tears from crying contain different chemicals (stress hormones) than tears from cutting onions.", ref: "Psychology Today" },
    { title: "Active Muscles", content: " The muscles that move your eyes are the fastest and strongest (for their size) in the body.", ref: "Loc.gov" },
    { title: "Color Blindness", content: "1 in 12 men are color blind, compared to only 1 in 200 women.", ref: "Colour Blindness" },
    { title: "20-20-20 Rule", content: "Every 20 mins, look 20 ft away for 20 secs. It's the reset button for your eyes.", ref: "AOA" },
    { title: "High-Five Check", content: "High-Five your screen. If you can't touch it with a straight arm, it's too far (or too close).", ref: "AOA" },
    { title: "Look Down", content: "Position monitors slightly below eye level. Looking up exposes more eye surface, causing dryness.", ref: "OSHA" },
    { title: "Blue Light", content: "Blue light suppresses melatonin. Use 'Night Shift' mode so you can actually fall asleep.", ref: "Harvard Health" },
    { title: "Cold Compress", content: "Got puffy eyes? A cold spoon or compress constricts blood vessels and reduces swelling fast.", ref: "Healthline" },
    { title: "Air Vents", content: "Don't let the AC or fan blow directly into your face. It turns your tears into vapor.", ref: "NEI" },
    { title: "Hydration", content: "Dehydrated body = Dry eyes. If you're thirsty, your eyes are likely thirsty too.", ref: "Mayo Clinic" },
    { title: "Polarized Lenses", content: "Driving? Polarized sunglasses reduce glare from the road and other cars.", ref: "AllAboutVision" }
];

const questionsPool = [
    { q: "Do you experience headaches after 2 hours of screen time?", type: "yesno" },
    { q: "Is your vision blurry when looking at distant objects?", type: "yesno" },
    { q: "Do your eyes feel dry or gritty?", type: "yesno" },
    { q: "Do you find yourself squinting to read the board?", type: "yesno" },
    { q: "Are your eyes sensitive to light?", type: "yesno" },
    { q: "Do you see double vision?", type: "yesno" },
    { q: "Do you have difficulty seeing at night?", type: "yesno" },
    { q: "Do you rub your eyes frequently?", type: "yesno" },
    { q: "Is your neck or shoulder painful after computer use?", type: "yesno" },
    { q: "Do you see halos around lights?", type: "yesno" },
    { q: "Do you have to hold your phone very close to read?", type: "yesno" },
    { q: "Do your eyes tear up excessively?", type: "yesno" },
    { q: "Do your eyelids twitch involuntarily?", type: "yesno" },
    { q: "Do your eyes look red or bloodshot?", type: "yesno" },
    { q: "Do colors look washed out or faded?", type: "yesno" },
    { q: "Do you feel a burning sensation in your eyes?", type: "yesno" },
    { q: "Is it hard to refocus when looking up from your screen?", type: "yesno" },
    { q: "Do your eyes feel heavy or tired?", type: "yesno" },
    { q: "Do you lose your place while reading lines of text?", type: "yesno" }
];

// --- ROUTES ---
// 1. Get Prescriptions
app.get('/api/prescriptions', requireAuth, async (req, res) => {
    const { data, error } = await supabase
        .from('prescriptions')
        .select('*')
        .eq('user_id', req.user.id)
        .order('checkup_date', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// 2. Add Prescription
app.post('/api/prescriptions', requireAuth, async (req, res) => {
    const { left, right, notes, date } = req.body;
    const { error } = await supabase
        .from('prescriptions')
        .insert([{ user_id: req.user.id, left_eye: left, right_eye: right, notes, checkup_date: date }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Saved successfully" });
});

// 3. Get Flashcards (Random 5 out of 30)
app.get('/api/flashcards', (req, res) => {
    const fullDeck = [...flashcardsPool]; 
    const shuffled = fullDeck.sort(() => 0.5 - Math.random());
    const selectedTen = shuffled.slice(0, 5);
    res.json(selectedTen);
});

// 4. Get Assessment (Random 10)
app.get('/api/assessment', (req, res) => {
    const shuffled = [...questionsPool].sort(() => 0.5 - Math.random());
    res.json(shuffled.slice(0, 10));
});

// 5. Submit Assessment
app.post('/api/assessment/submit', requireAuth, async (req, res) => {
    const { yesCount, total } = req.body;
    const isFlagged = (yesCount / total) >= 0.5;
    const { error } = await supabase
        .from('assessment_logs')
        .insert([{ user_id: req.user.id, score: yesCount, total, flagged: isFlagged }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ flagged: isFlagged });
});

// 6. Supabase Redirect Handler (Serves index.html from public folder)
app.get('/', (req, res) => {
    res.send("EyeGradeTracker Backend is Running!"); 
});

// 7. Endpoint for Changing Password 
app.put('/api/user/password', requireAuth, (req, res) => {
    res.status(200).json({ message: "Password update request received." });
});

// 8. Delete User and Associated Data (Requires AUTH and ADMIN KEY)
app.delete('/api/user/delete-account', requireAuth, async (req, res) => {
    const userId = req.user.id;
    
    try {
        const { error: logError } = await supabase.from('assessment_logs').delete().eq('user_id', userId);
        if (logError) throw logError;
        
        const { error: presError } = await supabase.from('prescriptions').delete().eq('user_id', userId);
        if (presError) throw presError;
        
        const { error: userError } = await supabase.auth.admin.deleteUser(userId);

        if (userError) {
            console.error("Supabase Admin Delete Error:", userError);
            return res.status(500).json({ error: 'Failed to delete user account.' });
        }

        res.json({ message: "Account successfully deleted." });

    } catch (err) {
        console.error("Server-side deletion error:", err);
        res.status(500).json({ error: `An internal error occurred during data cleanup: ${err.message}` });
    }
});

// 9. Send Checkup Reminder Email 
app.post('/api/send-reminder', requireAuth, async (req, res) => {
    const { email, next_checkup_date } = req.body;
    
    const success = await sendReminderEmail(email, next_checkup_date);

    if (!success) {
        return res.status(500).json({ success: false, error: 'Failed to send email via Nodemailer.' });
    }

    res.json({ success: true, message: 'Reminder email sent successfully.' });
});


app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));

app.delete('/api/prescriptions/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    const { error } = await supabase
        .from('prescriptions')
        .delete()
        .eq('id', id)
        .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "Deleted successfully" });
});