# World Updater (an extension I made out of boredom lol xd)

this extension is intended to use a local model (or an external API) to automatically update sillytavern variables, useful for tracking character status, locations, feelings, and even creating RPG systems. (it also supports JavaScript!! =D)

!!! **BUT BE AWARE** !!! since this extension allows raw JS execution. you have to be careful when importing or using random JS code.
PS: currently, 2026/05/19, i added some protections (if you import a JSON file, but do not trust 100% on this, please.)

## Concept

what i wanted to do was create a way where i, the user, don’t need to manually update the world info. then i thought it would be a great idea to simply use a local and online api — online api for rp, and a local model for the script!

the extension uses configurable profiles. each profile can have steps, and each step can have multiple prompt blocks.

### Steps

steps are the sequence of actions the extension will take. it’s possible to define steps for different functions, such as:

1. step 1 goes and grabs the character’s location
2. step 2 runs javascript and saves it into a variable

(i’ll soon provide profiles with examples! =d)

each step has its own history depth, chat history filter, and output filter!

### Prompt Blocks

inside each step, you can create blocks. this is where the step executes scripts or sends input to the ai. (ps: if you use js, the block will not be sent to the prompt)

prompt block inclusion can also be controlled:

1. "Always" = the prompt block will activate before and after the AI message
2. "After User" = the prompt block will activate only before the AI
3. "After (any) char" = the prompt block will activate only after a character. in group chats, you can select a specific character!
4. "When condition is true" = uses JS; if it returns true, the prompt block will be enabled

the prompt block also has an "except" field below it. there, you can write character names (if in a group) separated by commas. so if the prompt block is set to "always" or "after (any) char" but you don’t want it to trigger for a specific character, you can simply add their name there.

!! very important: Javascript prompt blocks **ALWAYS** execute first than the normal block, so if you want to execute script (after AI output) you have to attach it into the next step!

---

### Chat history formatting

i chose to send chat history as a json array by default, but you can change it to plain text, markdown, or a custom format in the profile settings.

if you want to attach chat history to the prompt, you can use the {{chat_history}} macro as listed below:

```
{{chat_history}} > normal, it pulls from any character  
{{chat_history::{{user}}}} > it pulls only from the user  
{{chat_history::{{char}}}} > it pulls only from the current character  
{{chat_history::char}} > it pulls only from characters  
```

additionally, you can use a custom name: {{chat_history::Alice}}

---

### Pre-filters and output filters

these options are meant to clean unnecessary text from the message (depending on what you want to do).

the chat history filter modifies the chat history before it is sent to the AI. for example, if you instruct your main rp model to output a character location inside <loc></loc>, you can use a pre-filter to extract only the location text. (as i said before, this is applied per step, so you don’t need to worry about it!)

example:

```
const regex = /<loc>(.*?)<\/loc>/s;
const match = text.match(regex);
if (match && match[1]) {
    return match[1].trim();
}
return '';
```

### Output filter

the output filter modifies the text after the ai generates it, but before it is saved.

so basically, if you are going to save the output into a variable, the filter will modify it before saving.

### Expectations option

sometimes the ai produces an output you don’t want. in that case, you can use the option below the output box: the expectations option. a simple example:

System: GUESS A LETTER

Expectation config: `return text.trim() === "h";`

Correction content: WRONG LETTER. You guessed: `{{failed_output}}`. Please try again.

### Save step to variable

at the very bottom, there is a field where you can write a variable name (the output will be saved to that variable). you can also execute a script after the output is finished.

1. save to variable > simple mode: just write the variable name you want. no need to wrap it in {{}}, because the extension already does that.

2. advanced >> when enabled, instead of saving to a variable, you can execute a js script. you can also still save variables in this mode.

example:

```
const varName = "putwhateveryouwanthere"; 
if (typeof context.chatMetadata.variables !== "object") {
    context.chatMetadata.variables = {};
}
context.chatMetadata.variables[varName] = resultText;
if (typeof context.saveMetadata === "function") {
    await context.saveMetadata();
}
```

## Useful macro list

* `{{chat_history}}` pulls the chat history based on your step’s history depth
* `{{chat_history::[Name/Role]}}` pulls chat history for a specific name (e.g. `{{chat_history::Alice}}`, `{{chat_history::{{user}}}}`, or `{{chat_history::{{char}}}}`)
* `{{mes}}` inserts the text of the most recent message in the chat
* `{{previous_output}}` inserts the result/text generated by the previous step in the chain
* `{{failed_output}}` is the “bad” output that failed validation/expectation checks

================================

examples:
github.com/coki333333-cmyk/world-updater-examples (just import them!)

================================

If you don’t have a good PC/notebook or whatever you use, you don’t need to use a very powerful local model!

My specs:
i5-2310 CPU
8GB RAM DDR3 1666Mhz
GPU: Intel HD
Storage: HDD

And I’m running qwen2.5-3b-instruct-q4_k_m from Kobold, and it’s fine!

I’ll soon update the README.md to give more instructions!! (i guess) ^^


final considerations:
yes im extremely lazy and creating this took me a *little* while and honestly im very lazy to write something else on this readme.md =,) but thats alright

![1](https://raw.githubusercontent.com/coki333333-cmyk/world-updater/9613ffef7a0add8c8d428e12e02bff39abbf3de3/ksnip_20260516-095406.png)

![2](https://raw.githubusercontent.com/coki333333-cmyk/world-updater/9613ffef7a0add8c8d428e12e02bff39abbf3de3/ksnip_20260516-095446.png)

![3](https://raw.githubusercontent.com/coki333333-cmyk/world-updater/9613ffef7a0add8c8d428e12e02bff39abbf3de3/ksnip_20260516-095501.png)

![4](https://raw.githubusercontent.com/coki333333-cmyk/world-updater/9613ffef7a0add8c8d428e12e02bff39abbf3de3/ksnip_20260516-095515.png)

![5](https://raw.githubusercontent.com/coki333333-cmyk/world-updater/9613ffef7a0add8c8d428e12e02bff39abbf3de3/ksnip_20260516-095533.png)

===========
list of codes
===========

(ps: i will update this soon! =D)
