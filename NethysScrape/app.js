/*
 * Archives of Nethys Scraper - built against 1E to get it close to working before 2E launch.
 * Let's watch them redesign the site entirely...
 *
 * Note: Currently fumbles on spells with multiple on 1 page. I don't trust that'll stay as-is anyway so I'm not reworking. Heightening has removed most those anyway.
 * 
 * Orksork note: The site was redesigned, I've added patches for a fix. IMO this should be re-written to use the "Spells" url instead of the provided "SpellLists",
 *   which now links to a filterable table view of spells with info available to filter out the spell sources *before* hitting the spell pages which otherwise results in unnecessary traffic.
 */

/**
 * Current manual cleanups:
 * 3 action spells - the to goes in the components currently. Need to make the actions an array with all the options.
 * Counter Performance - Really, you had to have 1 spell that allowed either cast action?
 * Casting time not measured in actions
 * Faerie Fire - I'm technically doing this wrong as it's an "or more"
 * Misses the uncommon trait (it has different CSS class - may also miss rare, alignment & size)
 */

'use strict';
const fs = require('fs');
const rp = require('request-promise-native');
const cheerio = require('cheerio');
const testRun = false;

var htmlTransform = (h) => cheerio.load(h);

const spellListRoots = [
    "https://2e.aonprd.com/SpellLists.aspx?Focus=true&Tradition=0",
    "https://2e.aonprd.com/SpellLists.aspx?Tradition=1",
    "https://2e.aonprd.com/SpellLists.aspx?Tradition=2",
    "https://2e.aonprd.com/SpellLists.aspx?Tradition=3",
    "https://2e.aonprd.com/SpellLists.aspx?Tradition=4",
    "https://2e.aonprd.com/SpellLists.aspx?Tradition=5"
];
const skipBooks = [
    "Core Rulebook",
    "Lost Omens World guide"
]
const relativePath = "https://2e.aonprd.com/";
var handledItems = [
    "name",
    "traits",
    "type",
    "level",
    "source",
    "traditions",
    "cast",
    "action",
    "range",
    "targets",
    "description",
    "components",
    "trigger",
    "area",
    "duration",
    "cost",
    "requirements",
    "casting-time"
];

function cleanup(s) {
    return s.trim().replace(/^;+/, "").replace(/;+$/, "").replace(/[��]/g, '-');
}

async function loadSpell(url) {
    try {
        var $ = await rp({
            'uri': url,
            'transform': htmlTransform
        });
        var spellData = {
            'nethysUrl': url.href
        };
        spellData.name = $('h1.title').clone().find("> span, > img").remove().end().text().trim();
        spellData.traits = [];
        var typeString = $('h1.title span').text();
        var typeMatch = typeString.match("(.*) (\\+?[0-9]*)")
        if (typeMatch) {
            spellData.type = typeMatch[1];
            spellData.level = parseInt(typeMatch[2]);
        }
        else spellData.type = typeString;

        var activeItem = null;
        var subItem = null;
        $('#ctl00_RadDrawer1_Content_MainContent_DetailedOutput').get(0).childNodes.forEach((elem, i) => {
            var e = cheerio(elem);
            if (e.is('span.trait')) { spellData.traits.push(e.text().toLowerCase()); }
            else if (e.is('b') || e.is('h3')) {
                var newItem = e.text().toLowerCase();
                if (handledItems.indexOf(newItem) == -1 && activeItem == "description") {
                    // Unhandled extras in desc - Just put them in bold
                    spellData[activeItem] += "  \r\n**" + e.text() + "** ";
                } else {
                    if (activeItem) {
                        if (subItem) { spellData[activeItem][subItem] = cleanup(spellData[activeItem][subItem]); }
                        else { spellData[activeItem] = cleanup(spellData[activeItem].trim()); }
                    }
                    activeItem = e.text().toLowerCase();
                    subItem = null;

                    var heightenMatch = activeItem.match(/^(heightened) \(([0-9])[a-z]{2}\)$/);
                    if (heightenMatch) {
                        activeItem = heightenMatch[1];
                        subItem = heightenMatch[2];
                    }

                    if (subItem) {
                        if (!spellData[activeItem]) spellData[activeItem] = {};
                        spellData[activeItem][subItem] = "";
                    }
                    else spellData[activeItem] = "";
                }
            }
            else if (e.is('hr')) {
                if (activeItem) {
                    if (subItem) { spellData[activeItem][subItem] = cleanup(spellData[activeItem][subItem]); }
                    else { spellData[activeItem] = cleanup(spellData[activeItem]); }
                }
                activeItem = "description";
                subItem = null;
                if (!spellData[activeItem]) spellData[activeItem] = "";
            }
            else if (e.is('span')) {
                if (activeItem == 'cast') {
                    switch (e.attr('title')) {
                        case "Single Action":
                            spellData.action = '1';
                            break;
                        case 'Two Actions':
                            spellData.action = '2';
                            break;
                        case 'Three Actions':
                            spellData.action = '3';
                            break;
                        case 'Reaction':
                            spellData.action = 'reaction';
                            break;
                        case 'Free Action':
                            spellData.action = 'free';
                            break;
                    }
                }
            }
            else if (activeItem && e.text()) {
                if (subItem) { spellData[activeItem][subItem] += e.text(); }
                else { spellData[activeItem] += e.text(); }
            }
        });
        // We've scraped, time for cleanup
        if (spellData.traditions) spellData.traditions = spellData.traditions.replace(/ /g, '').split(',');
        if (spellData.cast) spellData.components = spellData.cast.replace(/ /g, '').split(',');
       
        return spellData;
    }
    catch (err) {
        console.error("Error loading spell page " + url);
        console.error(err);
    }
}

async function loadAllSpells() {
    try {
        var spells = [];
        var loadedSpells = {};
        for (var ridx = 0; ridx < spellListRoots.length; ridx++) {
            var $ = await rp({
                'uri': spellListRoots[ridx],
                'transform': htmlTransform
            });
            console.log("Querying " + spellListRoots[ridx]);
            var spellLinks = $('#ctl00_RadDrawer1_Content_MainContent_DetailedOutput > a');
            for (var idx = 0; idx < spellLinks.length; idx++) {
                console.log("Reading spell " + idx + "/" + spellLinks.length);
                var a = spellLinks[idx];
                var spellUrl = cheerio(a).attr('href');
                if(spellUrl == "PFS.aspx") {
                    //Each spell's pre-image links to the pathfinder society page. This is a dumb hack to skip those but it works.
                    continue;
                }
                if (!loadedSpells[spellUrl]) {
                    loadedSpells[spellUrl] = true;
                    if (idx < 10 || !testRun) {
                        var url = new URL(spellUrl, relativePath);
                        var spell = await loadSpell(url);
                        if (spell.source && !skipBooks.find(v => spell.source.startsWith(v))) {
                            spells.push(spell);
                        }
                    }
                }
            };
        }
        console.log(spells);
        fs.writeFileSync("spells.json", JSON.stringify(spells, null, 4));
    }
    catch (err) {
        console.error("Error loading root spell page");
        console.error(err);
    };
};
loadAllSpells();