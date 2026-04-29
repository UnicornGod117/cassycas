import asyncio
from playwright.async_api import async_playwright
import os

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        abs_path = os.path.abspath("cas-calculator (2).html")
        await page.goto(f"file://{abs_path}")
        await asyncio.sleep(2)

        print("Verifying Step 4: Enter Key in Visual Mode")
        await page.evaluate("""() => {
            setInputMode('ml');
            const mf = document.getElementById('mf');
            mf.value = "5+5";
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true
            });
            mf.dispatchEvent(event);
        }""")
        await asyncio.sleep(1)

        # Check if cell c1 exists and has result 10
        cell_exists = await page.evaluate("document.getElementById('c1') !== null")
        result_text = await page.evaluate("document.getElementById('oc1').innerText") if cell_exists else ""

        print(f"Cell c1 exists: {cell_exists}")
        print(f"Result text: {result_text}")

        success = cell_exists and "10" in result_text
        print(f"Success: {success}")

        await browser.close()
        if not success:
            exit(1)

if __name__ == "__main__":
    asyncio.run(run())
