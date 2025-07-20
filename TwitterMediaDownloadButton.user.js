// ==UserScript==
// @name        Twitter Media Download Button
// @match       *://twitter.com/*
// @match       *://x.com/*
// @grant       GM_addStyle
// @grant       GM_download
// @grant       GM_xmlhttpRequest
// @connect     *
// @connect     pbs.twimg.com
// @version     1.3.0
// @author      ImoutoChan
// @description Downloads media (videos/images) from Twitter
// @homepageURL https://github.com/ImoutoChan/TwitterMediaDownloadButtonUserscript
// @downloadURL https://github.com/ImoutoChan/TwitterMediaDownloadButtonUserscript/raw/master/TwitterMediaDownloadButton.user.js
// @updateURL   https://github.com/ImoutoChan/TwitterMediaDownloadButtonUserscript/raw/master/TwitterMediaDownloadButton.user.js
// ==/UserScript==

(function() {
    "use strict";

    const BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
    const GRAPHQL_TWEET_DETAIL_ID = "-Ls3CrSQNo2fRKH6i6Na1A"; // Common GraphQL ID for TweetDetail

    GM_addStyle(`
        .tmd-action-wrapper {
            display: flex;
            align-items: center;
            margin-left: 30px;
        }
        .tmd-action-item {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            width: 38.5px;
            height: 38.5px;
            border-radius: 9999px;
            transition-property: background-color, box-shadow;
            transition-duration: 0.2s;
            box-sizing: border-box;
        }
        .tmd-action-item:hover {
            background-color: rgba(29, 155, 240, 0.1); /* Twitter blue with 10% opacity */
        }
        .tmd-icon {
            width: 18.75px;
            height: 18.75px;
            fill: rgb(83, 100, 113); /* Standard Twitter icon gray */
        }
        .tmd-action-item:hover .tmd-icon {
            fill: rgb(29, 155, 240); /* Twitter blue */
        }
    `);

    function getCookie(name) {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i].trim();
            if (cookie.startsWith(name + '=')) {
                return cookie.substring(name.length + 1);
            }
        }
        console.warn(`[TMD] Cookie "${name}" not found.`);
        return null;
    }

    function extractTweetInfo(tweetNode) {
        let username = 'unknown_user';
        let tweetId = 'unknown_id';
        let tweetDate = 'nodate';

        const timeElement = tweetNode.querySelector('a[href*="/status/"] time');
        if (timeElement && timeElement.hasAttribute('datetime')) {
            try {
                const date = new Date(timeElement.getAttribute('datetime'));
                const year = date.getFullYear();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const day = date.getDate().toString().padStart(2, '0');
                tweetDate = `${year}${month}${day}`;
            } catch (e) {
                console.warn('[TMD] Could not parse tweet date:', e);
            }
        }

        const permalinkElement = timeElement ? timeElement.closest('a[href*="/status/"]') : null;

        if (permalinkElement) {
            const href = permalinkElement.getAttribute('href');
            const parts = href.split('/').filter(p => p.length > 0);
            if (parts.length >= 3 && parts[1] === 'status') {
                username = parts[0];
                tweetId = parts[2].split('?')[0];
            }
        } else {
            const anyStatusLink = tweetNode.querySelector('a[href*="/status/"]');
            if (anyStatusLink) {
                const href = anyStatusLink.getAttribute('href');
                const parts = href.split('/').filter(p => p.length > 0);
                if (parts.length >= 3 && parts[1] === 'status') {
                    username = parts[0];
                    tweetId = parts[2].split('?')[0];
                }
            }
        }

        if (tweetId === 'unknown_id') {
            const article = tweetNode.closest('article');
            const labelledBy = article ? article.getAttribute('aria-labelledby') : null;
            if (labelledBy) {
                const idParts = labelledBy.split(' ');
                for (const part of idParts) {
                    if (/^\\d{10,}$/.test(part)) {
                        tweetId = part;
                        break;
                    }
                }
            }
        }

        if (username === 'unknown_user' && tweetId !== 'unknown_id') {
            const userNameElement = tweetNode.querySelector('[data-testid="User-Name"]');
            if (userNameElement) {
                const screenNameElement = Array.from(userNameElement.querySelectorAll('a[href^="/"] span'))
                                        .find(span => span.textContent.startsWith('@'));
                if (screenNameElement) {
                    username = screenNameElement.textContent.substring(1);
                }
            }
        }

        if (tweetId === 'unknown_id') console.warn('[TMD] Failed to extract Tweet ID reliably.');
        if (username === 'unknown_user') console.warn('[TMD] Failed to extract Username reliably.');
        if (tweetDate === 'nodate') console.warn('[TMD] Failed to extract Tweet Date reliably.');

        return { username, tweetId, tweetDate };
    }

    function addDownloadButton(tweetNode, attempt = 1) {
        const hasVideos = tweetNode.querySelector('video') !== null;
        let hasContentImages = false;
        const imageElements = Array.from(tweetNode.querySelectorAll('img[src*="pbs.twimg.com/media/"]'));
        for (const imgEl of imageElements) {
            if (imgEl.closest('a[href*="/photo/"]') || imgEl.closest('[data-testid="tweetPhoto"], [data-testid="tweetCardPhoto"]')) {
                hasContentImages = true;
                break;
            }
        }

        if (!hasVideos && !hasContentImages) {
            if (attempt < 3) {
                setTimeout(() => addDownloadButton(tweetNode, attempt + 1), 500);
            }
            return;
        }
        console.log(`[TMD] Media found in tweet (videos=${hasVideos}, images=${hasContentImages}). Attempting to add button.`);

        const actionBar = tweetNode.querySelector('div[role="group"]');
        if (!actionBar) {
            console.warn('[TMD] Action bar not found for tweet:', tweetNode);
            return;
        }

        if (actionBar.querySelector('.tmd-action-item')) {
            return;
        }

        const outerWrapper = document.createElement('div');
        outerWrapper.className = 'tmd-action-wrapper';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'tmd-action-item';
        buttonContainer.setAttribute('role', 'button');
        buttonContainer.setAttribute('tabindex', '0');
        buttonContainer.setAttribute('aria-label', 'Download');

        const svgIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgIcon.setAttribute("viewBox", "0 0 24 24");
        svgIcon.setAttribute("aria-hidden", "true");
        svgIcon.classList.add("tmd-icon");
        svgIcon.innerHTML = '<g><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path></g>';

        buttonContainer.appendChild(svgIcon);
        outerWrapper.appendChild(buttonContainer);

        buttonContainer.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            handleDownload(tweetNode);
        });

        actionBar.appendChild(outerWrapper);
    }

    async function handleDownload(tweetNode) {
        const { username, tweetId, tweetDate } = extractTweetInfo(tweetNode);

        console.log(`[TMD] Download triggered for tweet: username=${username}, tweetId=${tweetId}, tweetDate=${tweetDate}`);

        if (tweetId === 'unknown_id') {
            console.error("[TMD] Could not determine Tweet ID. Cannot proceed with download.");
            alert("Could not determine Tweet ID. Cannot proceed with download. Check console.");
            return;
        }

        const videoElements = Array.from(tweetNode.querySelectorAll('video'));
        console.log(`[TMD] Found ${videoElements.length} <video> elements.`);

        let downloadedViaApiOrDirectly = false;

        for (let i = 0; i < videoElements.length; i++) {
            const videoEl = videoElements[i];
            let videoUrl = videoEl.src || (videoEl.querySelector('source')?.src || null);

            console.log(`[TMD] Video #${i + 1}: raw src =`, videoEl.src);
            if (!videoUrl && videoEl.querySelector('source')) {
                console.log(`[TMD] Video #${i + 1}: fallback source =`, videoEl.querySelector('source').src);
            }

            if (videoUrl) {
                if (videoUrl.startsWith('blob:')) {
                    console.warn(`[TMD] Video #${i + 1} is a blob URL. Will attempt API lookup.`);

                    const ct0 = getCookie("ct0");
                    if (!ct0) {
                        console.error("[TMD] ct0 cookie not found. Cannot make API call for blob video.");
                        alert("Twitter login token (ct0 cookie) not found. API lookup failed.");
                        continue;
                    }

                    try {
                        console.log(`[TMD] Fetching direct video URL from API for tweetId: ${tweetId}`);
                        const directVideoUrl = await fetchVideoUrlFromAPI(tweetId, ct0);

                        if (directVideoUrl) {
                            const filename = generateFilename(username, tweetId, tweetDate, 'mp4', i, videoElements.length);
                            console.log(`[TMD] API provided direct video URL: ${directVideoUrl}`);
                            console.log(`[TMD] Downloading video #${i + 1} as ${filename}`);
                            triggerDownload(directVideoUrl, filename);
                            downloadedViaApiOrDirectly = true;
                        } else {
                            console.warn(`[TMD] API returned null for tweetId ${tweetId}`);
                        }
                    } catch (error) {
                        console.error(`[TMD] Exception during API lookup:`, error);
                        alert(`Error during API lookup for video. Check console. ${error.message || ''}`);
                    }

                    return;
                }

                const filename = generateFilename(username, tweetId, tweetDate, 'mp4', i, videoElements.length);
                console.log(`[TMD] Downloading direct video #${i + 1} from ${videoUrl} as ${filename}`);
                triggerDownload(videoUrl, filename);
                downloadedViaApiOrDirectly = true;
            } else {
                console.warn(`[TMD] Video #${i + 1} has no usable src.`);
            }
        }

        if (downloadedViaApiOrDirectly) return;

        const imageElements = Array.from(tweetNode.querySelectorAll('img[src*="pbs.twimg.com/media/"]'));
        console.log(`[TMD] Found ${imageElements.length} image elements.`);

        let downloadedImage = false;
        if (imageElements.length > 0) {
            for (let i = 0; i < imageElements.length; i++) {
                const imgEl = imageElements[i];
                if (imgEl.closest('a[href*="/photo/"]') || imgEl.closest('[data-testid="tweetPhoto"], [data-testid="tweetCardPhoto"]')) {
                    let imageUrl = imgEl.src;
                    try {
                        const url = new URL(imageUrl);
                        url.searchParams.set('name', 'orig');
                        imageUrl = url.toString();
                    } catch (e) {
                        console.error(`[TMD] Failed to enhance image URL ${imageUrl}:`, e);
                    }

                    const extensionMatch = imageUrl.match(/format=([a-zA-Z]+)/);
                    const extension = extensionMatch && extensionMatch[1] ? extensionMatch[1] : 'jpg';
                    const filename = generateFilename(username, tweetId, tweetDate, extension, i, imageElements.length);

                    console.log(`[TMD] Downloading image #${i + 1} from ${imageUrl} as ${filename}`);
                    triggerDownload(imageUrl, filename);
                    downloadedImage = true;
                }
            }
        }

        if (!downloadedViaApiOrDirectly && !downloadedImage) {
            console.warn('[TMD] No downloadable media found in tweet:', tweetNode);
            alert('No downloadable media found in this tweet. Check console for details.');
        }
    }

    function generateFilename(username, tweetId, tweetDate, extension, index = 0, mediaCount = 1) {
        const safeUsername = username.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const safeTweetId = tweetId.replace(/[^a-zA-Z0-9_]/g, '_');
        const safeDate = tweetDate === 'nodate' ? '' : `${tweetDate}_`;

        const suffix = mediaCount > 1 ? `_${index + 1}` : '';
        return `${safeUsername}_${safeDate}${safeTweetId}${suffix}.${extension}`;
    }

    async function fetchVideoUrlFromAPI(tweetId, ct0Token) {
        console.log("[TMD] [API] Starting fetchVideoUrlFromAPI...");

        if (!tweetId || tweetId === 'unknown_id') {
            console.error("[TMD] [API] Invalid tweetId for API call:", tweetId);
            return null;
        }
        if (!ct0Token) {
            console.error("[TMD] [API] ct0Token is missing for API call.");
            return null;
        }

        const variables = {
            focalTweetId: tweetId,
            with_rux_injections: false,
            includePromotedContent: true,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true,
            withV2Timeline: true,
        };

        const features = {
            rweb_lists_timeline_redesign_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            tweetypie_unmention_optimization_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: false,
            tweet_awards_web_tipping_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_media_download_video_enabled: false,
            responsive_web_enhance_cards_enabled: false,
        };

        const fieldToggles = {
            withAuxiliaryUserLabels: false,
            withArticleRichContentState: false
        };

        const apiUrl = `https://x.com/i/api/graphql/${GRAPHQL_TWEET_DETAIL_ID}/TweetDetail` +
              `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
              `&features=${encodeURIComponent(JSON.stringify(features))}` +
              `&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

        console.log("[TMD] [API] Sending request to:", apiUrl);

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: apiUrl,
                headers: {
                    "Authorization": `Bearer ${BEARER_TOKEN}`,
                    "Content-Type": "application/json",
                    "User-Agent": navigator.userAgent,
                    "Accept": "*/*",
                    "Accept-Language": navigator.language || "en-US,en;q=0.5",
                    "x-csrf-token": ct0Token,
                    "x-twitter-auth-type": "OAuth2Session",
                    "x-twitter-client-language": navigator.language.split('-')[0] || "en",
                    "x-twitter-active-user": "yes",
                },
                onload: function(response) {
                    console.log("[TMD] [API] Response status:", response.status);
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            console.log("[TMD] [API] Parsed JSON response:", data);

                            const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions;
                            const addEntries = instructions?.find(instr => instr.type === "TimelineAddEntries");
                            const entries = addEntries?.entries;
                            if (!entries) {
                                console.warn("[TMD] [API] No entries found in response.");
                                resolve(null);
                                return;
                            }

                            console.log(`[TMD] [API] Found ${entries.length} entries. Looking for tweetId: ${tweetId}`);
                            let tweetResult = null;

                            for (const entry of entries) {
                                if (entry.entryId.includes(`tweet-${tweetId}`)) {
                                    tweetResult = entry.content?.itemContent?.tweet_results?.result;
                                    console.log("[TMD] [API] Found matching entry:", tweetResult);
                                    break;
                                }
                            }

                            if (!tweetResult && entries[0]?.content?.itemContent?.tweet_results?.result) {
                                tweetResult = entries[0].content.itemContent.tweet_results.result;
                                console.log("[TMD] [API] Using fallback tweetResult:", tweetResult);

                                if (tweetResult?.legacy?.id_str !== tweetId && tweetResult?.rest_id !== tweetId) {
                                    console.warn("[TMD] [API] Fallback tweet does not match target tweet ID.");
                                    tweetResult = null;
                                }
                            }

                            if (!tweetResult) {
                                console.warn("[TMD] [API] Could not find tweetResult for tweetId:", tweetId);
                                resolve(null);
                                return;
                            }

                            const tweetData = tweetResult.tweet || tweetResult;
                            const media = tweetData?.legacy?.extended_entities?.media;

                            if (media && media.length > 0) {
                                for (const medium of media) {
                                    if (medium.type === "video" || medium.type === "animated_gif") {
                                        const variants = medium.video_info?.variants;
                                        console.log("[TMD] [API] Found video variants:", variants);

                                        if (variants && variants.length > 0) {
                                            const mp4Variants = variants
                                            .filter(v => v.content_type === "video/mp4" && v.url)
                                            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                                            if (mp4Variants.length > 0) {
                                                console.log("[TMD] [API] Selected video URL:", mp4Variants[0].url);
                                                resolve(mp4Variants[0].url);
                                                return;
                                            }
                                        }
                                    }
                                }
                            }

                            console.warn("[TMD] [API] No suitable video URL found in media.");
                            resolve(null);
                        } catch (e) {
                            console.error("[TMD] [API] Error parsing API response:", e);
                            reject(new Error("Error parsing API response."));
                        }
                    } else {
                        console.error("[TMD] [API] Request failed:", response.status, response.statusText, response.responseText);
                        reject(new Error(`API request failed: ${response.status} ${response.statusText}`));
                    }
                },
                onerror: function(error) {
                    console.error("[TMD] [API] Network error during API request:", error);
                    reject(new Error("Network error during API request."));
                }
            });
        });
    }

    function triggerDownload(url, filename) {
        fallbackDownload(url, filename);
    }

    function fallbackDownload(url, filename){
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            responseType: "blob",
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    try {
                        const blob = response.response;
                        const blobUrl = URL.createObjectURL(blob);

                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.style.display = 'none';
                        a.click();
                        document.body.removeChild(a);

                        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                    } catch (e) {
                        console.error("[TMD] Fallback: Error processing blob for download:", e);
                        alert("Fallback download failed: Could not process media blob. Check console.");
                    }
                } else {
                    console.error("[TMD] Fallback: Failed to fetch media, status:", response.status, response.statusText);
                    alert(`Fallback download failed: Server returned status ${response.status}. Check console.`);
                }
            },
            onerror: function(error) {
                console.error("[TMD] Fallback: GM_xmlhttpRequest error:", error);
                alert("Fallback download failed: Network error. Check console.");
            }
        });
    }

    function observeTweets() {
        const observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches('article[data-testid="tweet"]')) {
                                addDownloadButton(node);
                            }
                            node.querySelectorAll('article[data-testid="tweet"]').forEach(n => addDownloadButton(n));
                        }
                    });
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        document.querySelectorAll('article[data-testid="tweet"]').forEach(n => addDownloadButton(n));
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(observeTweets, 1000);
    } else {
        document.addEventListener('DOMContentLoaded', observeTweets);
    }
})();
