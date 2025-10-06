const playwright = require('playwright');
const USER1 = 'Test' + Math.random().toString().slice(2);

const browserPromise = playwright['chromium'].launch({
    // headless: false, slowMo: 100, // Uncomment to visualize test
});

Promise.all([async browser => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Load "http://localhost:5000/"
    await page.goto('http://localhost:5000/');

    // Resize window to 1854 x 963
    await page.setViewportSize({ width: 1854, height: 963 });

    // Click on <a> "👤 Your account"
    await Promise.all([
        page.click('[href="/me"]'),
        page.waitForNavigation()
    ]);

    // Click on <a> "Register"
    await Promise.all([
        page.click('[href="/register"]'),
        page.waitForNavigation()
    ]);

    // Click on <input> #email
    await page.click('#email');

    // Fill "ab@cd.nl" on <input> #email
    await page.fill('#email', `${USER1}@cd.nl`);

    // Press Tab on input
    await page.press('#email', 'Tab');

    // Fill "User1" on <input> #username > #username
    await page.fill('#username', USER1);

    // Press Tab on input
    await page.press('#username', 'Tab');

    // Fill "12345678" on <input> #password > #password
    await page.fill('#password', '12345678');

    // Press Tab on input
    await page.press('#password', 'Tab');

    // Fill "12345678" on <input> #password_confirm > #password_confirm
    await page.fill('#password_confirm', '12345678');

    // Press Tab on input
    await page.press('#password_confirm', 'Tab');

    // Press Enter on input
    await Promise.all([
        page.press('#submit', 'Enter'),
        page.waitForNavigation()
    ]);

    // Click on <a> "📍 Add spot"
    await page.click('#addspot-control > a');

    // Click on <button> "Done"
    await page.click('.step1 > button:nth-child(3)');

    // Click on <button> "Skip"
    await page.click('.step2 > button:nth-child(3)');

    // Click on <label> "★"
    await page.click('[title="4 stars"]');

    // Click on <input> [name="wait"]
    await page.click('[name="wait"]');

    // Fill "20" on <input> [name="wait"]
    await page.fill('[name="wait"]', '20');

    // Press Tab on input
    await page.press('[name="wait"]', 'Tab');

    // Fill "abcde" on <textarea> [name="comment"]
    await page.fill('[name="comment"]', 'abcde');

    // Click on <summary> "more optional fields"
    await page.click('#details-summary');

    // Click on <select> #signal
    await page.click('#signal');

    // Fill "sign" on <select> #signal
    await page.selectOption('#signal', 'sign');

    // Click on <input> #datetime_ride
    await page.click('#datetime_ride');

    // Fill "1994-01-01T01:01" on <input> #datetime_ride
    await page.fill('#datetime_ride', '2020-01-01T01:01');

    // Click on <button> "Submit"
    await page.click('#spot-form > button');

    await page.waitForSelector('.sidebar.success.visible')

    console.log('User test successful!')

}, async browser => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Load "http://localhost:5000/"
    await page.goto('http://localhost:5000/');

    // Resize window to 1854 x 963
    await page.setViewportSize({ width: 1854, height: 963 });

    // Click on <a> "📍 Add spot"
    await Promise.all([
        page.click('#addspot-control > a'),
        page.waitForNavigation()
    ]);

    // Click on <button> "Done"
    await page.click('.step1 > button:nth-child(3)');

    // Click on <button> "Skip"
    await page.click('.step2 > button:nth-child(3)');

    // Click on <label> "★"
    await page.click('[title="4 stars"]');

    // Click on <input> [name="wait"]
    await page.click('[name="wait"]');

    // Fill "10" on <input> [name="wait"]
    await page.fill('[name="wait"]', '10');

    // Press Tab on input
    await page.press('[name="wait"]', 'Tab');

    // Fill "a" on <textarea> [name="comment"]
    await page.fill('[name="comment"]', 'a');

    // Click on <button> "Submit"
    await page.click('button:nth-child(11)');

    await page.waitForSelector('.sidebar.success.visible')

    console.log('Anonymous test successful!')
}].map(async fn => {
    return fn(await browserPromise)
})).then(async _ => (await browserPromise).close())
