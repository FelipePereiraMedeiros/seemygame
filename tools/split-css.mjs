import { expandCss } from './css/graph.mjs';
// The migration is applied. This command validates and never overwrites CSS.
for (const file of ['css/main.css', 'css/landing.css', 'css/player.css', 'css/landing-premium.css', 'css/theme.css']) {
 const root = expandCss(file); let rules = 0; root.walkRules(() => rules++);
 console.log(file + ': ' + rules + ' rules, imports resolved in cascade order');
}
