// Practice letters for Letter Desk. All people, numbers, links and addresses are made up.
// kind: 'scam' or 'real'. minLevel: the desk level at which the letter can arrive.
export const DECK = [
  {
    id: 'toll', kind: 'scam', minLevel: 1, title: 'Toll text',
    text: `E-ZPass Notice: Your vehicle has an unpaid toll balance of $6.99. To avoid a late fee of $50.00 and suspension of your license, pay within 24 hours: https://ezpass-tollpay.support/pay?id=88213`,
  },
  {
    id: 'package', kind: 'scam', minLevel: 1, title: 'Package text',
    text: `USPS: Your parcel is held at our warehouse because the address is incomplete. Update your address within 24 hours or it will be returned: https://usps-redelivery.help/track?pkg=4418 A $1.25 redelivery fee applies.`,
  },
  {
    id: 'bank-code', kind: 'scam', minLevel: 1, title: '"Bank" alert',
    text: `Chase Fraud Alert: Did you try a $849.00 purchase at BestBuy? If NOT, reply NO and share the verification code we text you so we can stop it. Act now or your card will be suspended.`,
  },
  {
    id: 'water', kind: 'real', minLevel: 2, title: 'Water bill',
    text: `Springfield Water Department
Account number: SWD-4471220
Service address: 88 Oak Avenue, Springfield, IL 62704

Dear Thomas Reed,
Your bill for October is $63.18. Payment is due by December 12, 2026.
Pay by mail with the enclosed slip, or online at springfieldwater.org. Questions? Call 217-555-0190.`,
  },
  {
    id: 'irs', kind: 'scam', minLevel: 2, title: '"IRS" call',
    text: `This is Officer Daniel Brooks from the IRS Tax Crimes Unit. Mr. Robert Chen, a warrant has been issued for your arrest for unpaid taxes of $2,940. To settle immediately, purchase Google Play gift cards and call us back at 202-555-0187. Do not tell anyone about this case.`,
  },
  {
    id: 'prize', kind: 'scam', minLevel: 2, title: 'Prize letter',
    text: `Congratulations Ms. Linda Moore! You have won $1,500,000 in the National Sweepstakes. To release your prize, pay the $250 processing fee with a gift card within 48 hours. Keep this confidential until your check arrives.`,
  },
  {
    id: 'grandkid', kind: 'scam', minLevel: 3, title: '"Grandson" call',
    text: `Grandma, it's me, Jake. I had a car accident and I'm at the police station. I need $2,000 for bail right now. Please buy gift cards and read me the numbers. Don't tell Mom, she'll be so upset.`,
  },
  {
    id: 'hospital', kind: 'real', minLevel: 3, title: 'Hospital bill',
    text: `Riverside General Hospital — Patient Billing
Dear Maria Lopez,
Patient: Maria Lopez   DOB: 04/12/1951
Account number: RGH-55821934
Diagnosis: atrial fibrillation
Amount you owe: $437.60
Please pay by December 5, 2026. If you cannot pay in full, you may ask for a payment plan. Call Patient Financial Services at (217) 555-0142.`,
  },
  {
    id: 'tech', kind: 'scam', minLevel: 3, title: '"Microsoft" pop-up',
    text: `Microsoft Security Warning: your computer is infected and your bank account is at risk. Call support immediately at 1-888-555-0143. Our technician will connect with AnyDesk remote access to remove the virus.`,
  },
  {
    id: 'refund', kind: 'scam', minLevel: 4, title: '"Refund" email',
    text: `Amazon Billing: We accidentally refunded $1,900.00 to your account instead of $19.00. Please send back the difference today by Zelle to avoid legal action. Log in to verify: www.amaz0n-billing.top`,
  },
  {
    id: 'medicare', kind: 'real', minLevel: 4, title: 'Medicare notice',
    text: `MEDICARE SUMMARY NOTICE
Notice for: Helen Park
Medicare Number: 1EG4-TE5-MK73
Amount the provider may bill you: $46.32
THIS IS NOT A BILL. Appeals must be received by January 28, 2027.
Questions? Call 1-800-MEDICARE (1-800-633-4227).`,
  },
  {
    id: 'ssa', kind: 'scam', minLevel: 5, title: '"Social Security" text',
    text: `Social Security Administration: your SSN 512-44-7781 has been suspended because of suspicious activity. Call us now at 202-555-0164 to avoid arrest. Your benefits will be suspended within 24 hours.`,
  },
];

// Letter types the on-device model is asked to write (fresh practice letters, free and offline).
export const WRITE_TOPICS = [
  { kind: 'scam', topic: 'an unpaid toll text message with a link and a late fee' },
  { kind: 'scam', topic: 'a failed package delivery text with a link and a small redelivery fee' },
  { kind: 'scam', topic: 'a fake bank fraud alert that asks to share a verification code' },
  { kind: 'scam', topic: 'a fake prize letter that asks for a processing fee paid by gift card' },
  { kind: 'scam', topic: 'a fake tech support warning that asks to install remote access software' },
  { kind: 'real', topic: 'a normal electricity bill with an account number, an amount and a due date' },
  { kind: 'real', topic: 'a normal pharmacy reminder that a prescription is ready for pickup' },
];
