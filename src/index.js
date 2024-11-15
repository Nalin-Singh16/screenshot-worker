import puppeteer from "@cloudflare/puppeteer";

export default {
	async fetch(request, env) {
		console.log(request)
		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 });
		}
		let id = env.BROWSER.idFromName("browser");
		let obj = env.BROWSER.get(id);

		// Send a request to the Durable Object, then await its response.
		// let resp = await obj.fetch(request.url);
		let resp = await obj.fetch(request)
		return resp;
	},
};

const KEEP_BROWSER_ALIVE_IN_SECONDS = 120;

export class Browser {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.keptAliveInSeconds = 0;
		this.storage = this.state.storage;
	}

	async fetch(request) {
		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 })
		}
		const body = await request.json()
		console.log("body::::::::::", body.id, body.url, body.directory_name)
		const url = body.url
		const id = body.id
		const directory_name = body.directory_name
		// const { searchParams } = new URL(request.url);
		// const url = searchParams.get("url");
		// for (const urlData of urls) {
		// console.log("urlData:::::::::", urlData)
		const normalizedUrl = new URL(url).toString(); // normalize
		// const width = [1920, 1366, 1536, 360, 414];
		// const height = [1080, 768, 864, 640, 896];
		const width = [1920, 414];
		const height = [1080, 896];

		// Check if screenshots for this URL already exist in R2
		// const existingScreenshots = [];
		// for (let i = 0; i < width.length; i++) {
		// 	const fileName = `${id}_${width[i]}x${height[i]}.jpg`;
		// 	console.log('filename::::::::', fileName)
		// 	try {
		// 		const existing = await this.env.BUCKET.get(directory_name + "/" + fileName);
		// 		if (existing) {
		// 			existingScreenshots.push(await existing.arrayBuffer());
		// 		}
		// 	} catch (e) {
		// 		console.log(`Error checking existing screenshot: ${e}`);
		// 	}
		// }

		// If we have all screenshots, return them
		// if (existingScreenshots.length === width.length) {
		// 	return new Response(JSON.stringify({
		// 		message: "Retrieved existing screenshots",
		// 		// screenshots: existingScreenshots
		// 	}));
		// }

		if (!this.browser || !this.browser.isConnected()) {
			console.log(`Browser DO: Starting new instance`);
			try {
				this.browser = await puppeteer.launch(this.env.MYBROWSER);
			} catch (e) {
				console.log(
					`Browser DO: Could not start browser instance. Error: ${e}`,
				);
				return new Response("Error launching browser", { status: 500 });
			}
		}

		// Reset keptAlive after each call to the DO
		this.keptAliveInSeconds = 0;

		const page = await this.browser.newPage();
		const screenshots = [];

		// take screenshots of each screen size
		for (let i = 0; i < width.length; i++) {
			await page.setViewport({ width: width[i], height: height[i] });
			await page.goto(normalizedUrl, {
				waitUntil: 'networkidle2'
			});
			const fileName = `${id}_${width[i]}x${height[i]}`;
			console.log("Taking screenshot:", fileName)
			// const sc = await page.screenshot({ path: fileName + ".jpg" });
			const sc = await page.screenshot({ fullPage: true });
			screenshots.push(sc);
			await this.env.BUCKET.put(directory_name + "/" + fileName + ".jpg", sc);
		}

		// Close tab when there is no more work to be done on the page
		await page.close();

		// Reset keptAlive after performing tasks to the DO.
		this.keptAliveInSeconds = 0;

		// set the first alarm to keep DO alive
		let currentAlarm = await this.storage.getAlarm();
		if (currentAlarm == null) {
			console.log(`Browser DO: setting alarm`);
			const TEN_SECONDS = 10 * 1000;
			await this.storage.setAlarm(Date.now() + TEN_SECONDS);
		}

		// }
		return new Response("success");
	}

	async alarm() {
		this.keptAliveInSeconds += 10;

		// Extend browser DO life
		if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
			console.log(
				`Browser DO: has been kept alive for ${this.keptAliveInSeconds} seconds. Extending lifespan.`,
			);
			await this.storage.setAlarm(Date.now() + 10 * 1000);
			// You could ensure the ws connection is kept alive by requesting something
			// or just let it close automatically when there  is no work to be done
			// for example, `await this.browser.version()`
		} else {
			console.log(
				`Browser DO: exceeded life of ${KEEP_BROWSER_ALIVE_IN_SECONDS}s.`,
			);
			if (this.browser) {
				console.log(`Closing browser.`);
				await this.browser.close();
			}
		}
	}
}