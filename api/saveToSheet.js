export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { name, email, phone, plan } = req.body;

  const SHEET_ID = "1VrfIQOzGjeUvYWftj9FgpbDxZUFkycIsb3WchIFr-KY";
  const API_KEY = "AIzaSyAED4zu8DpbIYPpSkQWgMs1LwqAo_W83zY";
  const GOOGLE_SCRIPT_WEBAPP = "https://script.google.com/macros/s/AKfycbx5gmjnb2SKjn1ZAKB_GqXbAXXaclCxCZwCYkqo_zxj7OfOaD6yxyCGUkGmUoMzxjwk/exec";

  try {
    // Check for duplicate email
    const checkRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/licensekeys!D2:D?key=${API_KEY}`
    );
    const checkData = await checkRes.json();
    const existingEmails = checkData.values ? checkData.values.flat() : [];

    if (existingEmails.includes(email)) {
      return res.status(400).json({ message: "This email already exists in our system." });
    }

    // Generate random license key
    const licenseKey = Array.from({ length: 6 }, () =>
      Math.random().toString(16).substr(2, 4).toUpperCase()
    ).join("-");

    const today = new Date();
    const startDate = today.toISOString().split("T")[0];
    const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    // Status formula (must match the column layout)
    const statusFormula = `=IF(OR(ISBLANK(F2),ISBLANK(G2),NOT(ISNUMBER(DATEVALUE(F2))),NOT(ISNUMBER(DATEVALUE(G2)))),"INACTIVE",IF(AND(TODAY() >= DATEVALUE(F2),TODAY()<= DATEVALUE(G2)),"ACTIVE","INACTIVE"))`;

    // Send data to Google Apps Script to write in correct order
    await fetch(GOOGLE_SCRIPT_WEBAPP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: licenseKey,   // A
        name,              // B
        phone,             // C
        email,             // D
        plan,              // E
        start: startDate,  // F
        end: endDate,      // G
        sessionId: "",     // H
        sessionTime: "",   // I
        status: statusFormula // J
      })
    });

    return res.status(200).json({ message: "Success" });

  } catch (err) {
    console.error("Error saving to sheet:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
