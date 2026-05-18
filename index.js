(function() {
  // start
  const context = SillyTavern.getContext();
  const {
    eventSource,
    event_types,
    extensionSettings,
    saveSettingsDebounced,
    renderExtensionTemplateAsync,
    substituteParams,
    generateRaw
  } = context;
  const MODULE_NAME = 'world_updater';

  let isUpdating = false;
  let abortController = null;
  let wu_editor_decorator = null;
  let wu_editor_decorator_cond = null;

  const wu_console_logs_value = 0;
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

  const defaultProfile = {
    name: "New Profile",
    run_mode: 'auto',
    use_internal: false,
    history_format: 'json',
    custom_history_format: '{{name}}: {{message}}',
    api_url: 'http://127.0.0.1:5001/v1/chat/completions',
    api_key: '', // NOT USABLE ANYMORE
    model: '', // NOT USABLE ANYMORE
    temperature: 0.1,
    frequency_penalty: 0,
    top_p: 1.0,
    repeat_penalty: 1.1,
    presence_penalty: 0,
    top_k: 40,
    min_p: 0.05,
    max_tokens: 20,
    steps: [{
      name: 'Step 1',
      variable_name: 'world_state',
      history_depth: 1,
      pre_filter_enabled: false,
      pre_filter_script: "return text;",
      enabled: true,
      order: 128,
      filter_enabled: false,
      advanced_save_enabled: false,
      filter_script: "return text.replace(/(^|\\n)-(\\S)/g, '$1- $2');",
      advanced_save_script: "await context.executeSlashCommands('/echo ' + resultText);",
      expected_enabled: false,
      expected_script: "return text.trim().length > 0;",
      correction_enabled: false,
      max_attempts: 3,
      correction_role: 'user',
      correction_order: 1,
      correction_content: 'Your last output:\n{{failed_output}}\n\nIs invalid. Please follow the rules and try again.',
      blocks: [{
          role: 'system',
          content: 'Extract the core Location Name and Character Names.\nRules:\n1. Location: Use the shortest specific name. No descriptions (e.g., no "The dark room of").\n2. Characters: List every character mentioned.\n3. Style: Strict Template. No talking.\n\nEXAMPLES:\nInput: "He walked through the busy streets of New York with Peter."\nResult:\n[New York]\n- Peter\n\nInput: "Inside the messy kitchen, Mary and John were cooking."\nResult:\n[Kitchen]\n- Mary\n- John\n\nInput: "The dragon flew over the Volcanic Mountains of Doom."\nResult:\n[Mountains of Doom]\n- Dragon',
          order: 128,
          isCode: false,
          history_filter: 'all',
          history_filter_name: '',
          history_exclude: '',
          run_condition_js: 'return true;'
        },
        {
          role: 'user',
          content: 'Data to analyze:\n"""\n{{chat_history}}\n"""',
          order: 128,
          isCode: false,
          history_filter: 'all',
          history_filter_name: '',
          history_exclude: '',
          run_condition_js: 'return true;'
        }
      ]
    }]
  };


  // java stuff

  async function loadEditorResources() {
    const extensionPath = 'scripts/extensions/third-party/world-updater/';
    if (!document.getElementById('wu-editor-styles')) {
      const link = document.createElement('link');
      link.id = 'wu-editor-styles';
      link.rel = 'stylesheet';
      link.href = `${extensionPath}editor.css`;
      document.head.appendChild(link);
    }
    const scripts = ['parser.js', 'decorator.js'];
    for (const file of scripts) {
      if (!document.querySelector(`script[src*="${file}"]`)) {
        await new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = `${extensionPath}${file}`;
          script.onload = resolve;
          document.head.appendChild(script);
        });
      }
    }
  }

  function applyJavaHighlighting(el) {
    if (!el || typeof Parser === 'undefined' || typeof TextareaDecorator === 'undefined') return null;
    if (el.parentElement && el.parentElement.classList.contains('ldt')) return null;
    const javaParser = new Parser({
      comment: /\/\/.*|\/\*[\s\S]*?\*\//,
      string: /"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`/,
      keyword: /\b(break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|function|if|import|in|instanceof|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|let|static|public|private|protected)\b/,
      builtin: /\b(console|window|document|Math|JSON|Object|Array|String|Number|Boolean|Promise|SillyTavern|context|toastr|substituteParams|generateRaw|eventSource|event_types)\b/,
      boolean: /\b(true|false|null|undefined|NaN)\b/,
      number: /\b\d+(\.\d+)?\b/,
      function: /\b[a-z_]\w*(?=\s*\()/,
      bracket: /[(){}\[\]]/,
      operator: /[+\-*/%=<>!&|^~?:]+/,
      punctuation: /[.,;]/,
      word: /[a-zA-Z_]\w*/,
      whitespace: /\s+/,
      default: /[^\s]/
    });

    const decorator = new TextareaDecorator(el, javaParser);
    const inputArea = decorator.input; // This is the actual textarea inside the LDT wrapper

    // 1. SCROLL DRIFT FIX
    decorator.update = (function(originalUpdate) {
        return function() {
            originalUpdate.apply(this, arguments);
            this.input.removeAttribute('rows');
            this.input.removeAttribute('cols');
            this.input.style.height = '100%';
            this.input.style.width = '100%';
        };
    })(decorator.update);

    // 2. LISTENERS (Attached to inputArea to be safe)
    inputArea.addEventListener('input', () => {
        // This will now definitely fire on every keystroke
        validateJavascript(decorator);
    });

    inputArea.addEventListener('click', () => updateBracketMatching(decorator));
    
    inputArea.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '{', '}', '(', ')', '[', ']'].includes(e.key)) {
          updateBracketMatching(decorator);
      }
    });

    inputArea.addEventListener('keydown', (e) => handleTabKey(e, decorator));

    // Run once immediately
    validateJavascript(decorator);
    
    return decorator;
  }

  function clearDecorators() {
    $('.ldt').each(function() {
      const textarea = $(this).find('textarea')[0];
      if (textarea) {
        $(this).before(textarea);
        $(this).remove();
        $(textarea).css({
          'color': '',
          'background': '',
          'caret-color': ''
        });
      }
    });
    wu_editor_decorator = null;
    wu_editor_decorator_cond = null;
  }


  function updateBracketMatching(decorator) {
    const textarea = decorator.input;
    const output = decorator.output;
    const text = textarea.value;
    const pos = textarea.selectionStart;

    // Clear previous highlights
    $(output).find('.bracket-match').removeClass('bracket-match');

    const brackets = { '(': ')', '{': '}', '[': ']', ')': '(', '}': '{', ']': '[' };
    const char = text[pos] || text[pos - 1]; // Check char at or just before cursor
    const activePos = (brackets[text[pos]]) ? pos : (brackets[text[pos - 1]] ? pos - 1 : -1);

    if (activePos === -1) return;

    const open = text[activePos];
    const close = brackets[open];
    const direction = ['(', '{', '['].includes(open) ? 1 : -1;
    
    let stack = 0;
    let matchPos = -1;

    for (let i = activePos; i >= 0 && i < text.length; i += direction) {
      if (text[i] === open) stack++;
      else if (text[i] === close) stack--;
      
      if (stack === 0) {
        matchPos = i;
        break;
      }
    }

    if (matchPos !== -1) {
      let currentIdx = 0;
      const nodes = output.childNodes;
      for (let n = 0; n < nodes.length; n++) {
        const nodeLen = nodes[n].textContent.length;
        if (currentIdx === activePos || currentIdx === matchPos) {
          nodes[n].classList.add('bracket-match');
        }
        currentIdx += nodeLen;
      }
    }
  }

  function validateJavascript(decorator) {
      const code = decorator.input.value;
      const output = decorator.output;
      const title = $('#wu_editor_title');

      if (!title.data('base-text')) {
          title.data('base-text', title.text());
      }
      $(output).find('.syntax-error-line').removeClass('syntax-error-line');
      title.removeClass('has-error');
      title.text(title.data('base-text')); 

      if (!code.trim()) return;

      try {
          new AsyncFunction("previous_output", "chat_history", "mes", "variables", "substituteParams", code);
      } catch (err) {
          title.addClass('has-error'); 
          let lineNum = 1;

          const OFFSET = 2;

          if (err.lineNumber) {
              lineNum = err.lineNumber - OFFSET;
          } else if (err.stack) {
              const stackMatch = err.stack.match(/<anonymous>:(\d+):(\d+)/);
              if (stackMatch && stackMatch[1]) {
                  lineNum = parseInt(stackMatch[1]) - OFFSET;
              }
          } else if (err.line) {
              lineNum = err.line - OFFSET;
          }

          const totalLines = code.split('\n').length;

          if (isNaN(lineNum) || lineNum < 1) {
              lineNum = 1;
          } else if (lineNum > totalLines) {
              lineNum = totalLines;
          }

          const errorText = `?${err.message}${'\u00A0'.repeat(6)}error in ${lineNum}`.toUpperCase();
          title.text(`${title.data('base-text')} ${errorText}`);
          let currentLine = 1;
          const nodes = Array.from(output.childNodes);
          for (const node of nodes) {
              const nodeText = node.textContent;
              const linesInNode = (nodeText.match(/\n/g) || []).length;
              
              if (lineNum >= currentLine && lineNum <= currentLine + linesInNode) {
                  node.classList.add('syntax-error-line');
              }
              currentLine += linesInNode;
          }
      }
  }

  function handleTabKey(e, decorator) {
    if (e.key !== 'Tab') return;
    e.preventDefault();

    const el = e.target;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;
    const tabSize = 2; // As requested: 2 spaces
    const spaces = " ".repeat(tabSize);

    // Case 1: Multiple lines selected (Block Indent/Outdent)
    if (start !== end && value.slice(start, end).includes('\n')) {
      // Expand selection to start of first line and end of last line
      const lineStart = value.lastIndexOf('\n', start) + 1;
      let lineEnd = value.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = value.length;

      const selectedText = value.slice(lineStart, lineEnd);
      const lines = selectedText.split('\n');

      let newLines;
      if (e.shiftKey) {
        // Shift + Tab: Remove up to 2 spaces
        newLines = lines.map(line => {
          if (line.startsWith(spaces)) return line.substring(tabSize);
          if (line.startsWith(" ")) return line.substring(1);
          return line;
        });
      } else {
        // Tab: Add 2 spaces
        newLines = lines.map(line => spaces + line);
      }

      const newText = newLines.join('\n');
      el.value = value.slice(0, lineStart) + newText + value.slice(lineEnd);

      // Restore selection
      el.selectionStart = lineStart;
      el.selectionEnd = lineStart + newText.length;
    }
    // Case 2: Single line or cursor only
    else {
      if (e.shiftKey) {
        // Outdent single line
        const lineStart = value.lastIndexOf('\n', start) + 1;
        const lineBegin = value.slice(lineStart, start);
        if (lineBegin.startsWith(spaces)) {
          el.value = value.slice(0, lineStart) + value.slice(lineStart + tabSize);
          el.selectionStart = el.selectionEnd = start - tabSize;
        } else if (lineBegin.startsWith(" ")) {
          el.value = value.slice(0, lineStart) + value.slice(lineStart + 1);
          el.selectionStart = el.selectionEnd = start - 1;
        }
      } else {
        // Insert spaces at cursor
        el.value = value.substring(0, start) + spaces + value.substring(end);
        el.selectionStart = el.selectionEnd = start + tabSize;
      }
    }

    // CRITICAL: Tell LDT to update colors for the new text
    decorator.update();
  }

  //
  // java stuff
  // above is java stuff, below is.... uh... yeah, the codes

  function formatStepForExport(step, stepIndex, isSingle) {
    let out = "";
    if (isSingle) {
      out += "// PROMPT BLOCK LIST\n\n";
    } else {
      out += `// STEP ${stepIndex + 1}\n\n`;
    }

    (step.blocks || []).forEach((block, bIndex) => {
      // Create the block name
      const blockName = `BLOCK${bIndex + 1}${block.isCode ? ' (JS)' : ''}`;

      // Start of Block
      out += `=================\n= ${blockName}\n=================\n\n`;
      
      // Order
      out += `===\nOrder: \`\`\`${block.order ?? 128}\`\`\`\n===\n\n`;

      if (block.history_filter === 'condition') {
        // Condition format
        out += `===\nWhen condition is:\n\`\`\`\n${block.run_condition_js || ''}\n\`\`\`\nThen:\n\`\`\`\n${block.content || ''}\n\`\`\`\n===\n\n`;
      } else {
        // Normal trigger format
        let triggerName = block.history_filter || 'all';
        if (triggerName === 'name') triggerName = `${block.history_filter_name}`;
        else if (triggerName === 'all') triggerName = 'All';
        else if (triggerName === 'user') triggerName = 'User';
        else if (triggerName === 'char') triggerName = 'Char';

        out += `===\nTrigger: \`\`\`${triggerName}\`\`\`\n===\n\n`;
        if (block.history_exclude && block.history_exclude.trim() !== "") {
          out += `Except: \`\`\`${block.history_exclude}\`\`\`\n`;
        }
        out += `===\nContent:\n\n\`\`\`\n${block.content || ''}\n\`\`\`\n===\n\n`;
      }

      // End of Block
      out += `=================\n= ${blockName}\n=================\n\n`;
    });

    // Output Section
    out += `=================\n= OUTPUT\n=================\n`;
    out += `${step.last_output || "No output for this step yet"}\n`;
    out += `=================\n= OUTPUT\n=================\n\n`;

    // Save / Advanced Script Section
    if (step.advanced_save_enabled && step.advanced_save_script) {
      out += `===\nRun script after step ${stepIndex + 1} output:\n\`\`\`\n${step.advanced_save_script || ''}\n\`\`\`\n===\n\n`;
    } else if (step.variable_name) {
      out += `===\nSave to variable:\n\`\`\`\n{{${step.variable_name}}}\n\`\`\`\n===\n\n`;
    }

    out += `---\n\n`;
    return out;
  }

  function wu_log(...args) {
    if (wu_console_logs_value === 1) {
      console.log(`World Updater:`, ...args); // wu_log("example"); or wu_log(`example`);
      console.trace();
    }
  }

  function loadSettings() {
    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = {};
    const settings = extensionSettings[MODULE_NAME];

    if (settings.api_url !== undefined && !settings.profiles) {
      settings.profiles = [{
        name: "Local",
        api_url: settings.api_url,
        api_key: '',
        temperature: settings.temperature,
        frequency_penalty: settings.frequency_penalty,
        max_tokens: settings.max_tokens,
        history_depth: settings.history_depth,
        steps: [{
          name: 'Step 1',
          variable_name: settings.variable_name || '',
          enabled: true,
          blocks: settings.blocks || []
        }]
      }];
      settings.active_profile = 0;
      delete settings.api_url;
      delete settings.temperature;
      delete settings.frequency_penalty;
      delete settings.max_tokens;
      delete settings.history_depth;
      delete settings.blocks;
      delete settings.variable_name;
    }

    if (!settings.profiles || settings.profiles.length === 0) {
      settings.profiles = [JSON.parse(JSON.stringify(defaultProfile))];
    } else {
      settings.profiles.forEach(profile => {
        if (profile.blocks && !profile.steps) {
          profile.steps = [{
            name: 'Step 1',
            variable_name: profile.variable_name || '',
            enabled: true,
            blocks: profile.blocks
          }];
          delete profile.blocks;
          delete profile.variable_name;
        }

        // step structure integrity
        if (profile.steps) {
          profile.steps.forEach(step => {
            if (step.enabled === undefined) step.enabled = true;
            if (step.order === undefined) step.order = 128;
            if (!step.blocks) step.blocks = [{
              role: 'system',
              content: '',
              order: 128
            }];
            if (step.filter_enabled === undefined) step.filter_enabled = false;
            if (step.filter_script === undefined) step.filter_script = "return text.replace(/(^|\\n)-(\\S)/g, '$1- $2');";
            step.blocks.forEach(block => {
              if (block.order === undefined) block.order = 128;
              if (block.isCode === undefined) block.isCode = false;
              if (block.history_filter === undefined) block.history_filter = 'all';
              if (block.history_filter_name === undefined) block.history_filter_name = '';
              if (block.history_exclude === undefined) block.history_exclude = '';
              if (block.run_condition_js === undefined) block.run_condition_js = 'return true;';
            });
            if (step.advanced_save_enabled === undefined) step.advanced_save_enabled = false;
            if (step.advanced_save_script === undefined) step.advanced_save_script = "";
            if (step.history_depth === undefined) step.history_depth = profile.history_depth ?? 1;
            if (step.pre_filter_enabled === undefined) step.pre_filter_enabled = profile.pre_filter_enabled ?? false;
            if (step.pre_filter_script === undefined) step.pre_filter_script = profile.pre_filter_script ?? "return text;";
            if (step.expected_enabled === undefined) step.expected_enabled = false;
            if (step.expected_script === undefined) step.expected_script = "return text.trim().length > 0;";
            if (step.max_attempts === undefined) step.max_attempts = 3;
            if (step.correction_enabled === undefined) step.correction_enabled = false;
            if (step.correction_role === undefined) step.correction_role = 'user';
            if (step.correction_order === undefined) step.correction_order = 1;
            if (step.correction_content === undefined) step.correction_content = 'Your last output:\n{{failed_output}}\n\nIs invalid. Please follow the rules and try again.';
          });
        }
        delete profile.history_depth;
        delete profile.pre_filter_enabled;
        delete profile.pre_filter_script;

        if (profile.steps.length === 0) {
          profile.steps = [JSON.parse(JSON.stringify(defaultProfile.steps[0]))];
        }

        // default profile keys
        for (const key in defaultProfile) {
          if (profile[key] === undefined) {
            profile[key] = typeof defaultProfile[key] === 'object' ?
              JSON.parse(JSON.stringify(defaultProfile[key])) :
              defaultProfile[key];
          }
        }
        if (profile.run_mode === undefined) profile.run_mode = 'after_ai';
      });
    }

    if (settings.active_profile === undefined) settings.active_profile = 0;
    if (settings.last_output === undefined) settings.last_output = 'No updates yet...';
    if (settings.active_step_index === undefined) settings.active_step_index = 0;
  }

  function updateRunButton(running) {
    const btn = $('#wu_force_run');
    if (running) {
      btn.html('<i class="fa-solid fa-stop" style="margin-right: 5px;"></i> Stop')
        .css({
          'background': 'rgba(255, 50, 50, 0.4)',
          'border-color': 'rgba(255, 50, 50, 0.6)',
          'color': '#ff4444'
        });
    } else {
      btn.html('<i class="fa-solid fa-play" style="margin-right: 5px;"></i> Run')
        .css({
          'background': 'rgba(0, 255, 204, 0.1)',
          'border-color': 'rgba(0, 255, 204, 0.3)',
          'color': '#00ffcc'
        });
    }
  }

  function toggleRunButtonVisibility() {
    const stContext = SillyTavern.getContext();
    const isInChat = !!(stContext.chatId || stContext.groupId || (stContext.chat && stContext.chat.length > 0));
    if (isInChat) {
      $('#wu_force_run').show();
    } else {
      $('#wu_force_run').hide();
    }
  }

  function renderSteps() {
    const settings = extensionSettings[MODULE_NAME];
    const activeProfile = settings.profiles[settings.active_profile];
    const container = $('#wu_steps_container');
    container.empty();

    // if there are no steps, show a big add button to recover
    if (!activeProfile.steps || activeProfile.steps.length === 0) {
      container.html(`
                <div style="text-align: center; color: #888; padding: 20px; border: 1px dashed rgba(255,255,255,0.2); border-radius: 5px; background: rgba(0,0,0,0.2);">
                    <div>There are no steps.</div>
                    <div style="height: 12px;"></div>
                    <button id="wu_add_step" class="menu_button"
                        style="padding: 5px 15px; width: 100%; font-weight: bold; color: #00ffcc; border-color: rgba(0,255,204,0.3); background: rgba(0,255,204,0.1);">+ Add Chain Step</button>
            </div>`);
      return;
    }

    if (settings.active_step_index >= activeProfile.steps.length) settings.active_step_index = 0;
    const activeIndex = settings.active_step_index;
    const currentStep = activeProfile.steps[activeIndex];

    let blocksHtml = '';
    if (currentStep) {
      const sortedBlocks = [...currentStep.blocks].sort((a, b) => (a.order || 128) - (b.order || 128));
      const stContext = SillyTavern.getContext();
      let chatCharacters = [];
      if (stContext.groupId && stContext.characterId === undefined && stContext.groups) {
        const currentGroup = stContext.groups.find(g => g.id === stContext.groupId);
        if (currentGroup && currentGroup.members) {
          chatCharacters = (stContext.characters || []).filter(c => currentGroup.members.includes(c.avatar));
        }
      }

      sortedBlocks.forEach((block, bIndex) => {
        const origBIndex = currentStep.blocks.indexOf(block);

        let filterSelectHtml = `
                    <option value="all" ${block.history_filter === 'all' ? 'selected' : ''}>Always</option>
                    <option value="user" ${block.history_filter === 'user' ? 'selected' : ''}>After User</option>
                    <option value="char" ${block.history_filter === 'char' ? 'selected' : ''}>After (any) Char</option>
                    <option value="condition" ${block.history_filter === 'condition' ? 'selected' : ''}>When condition is true</option>
             `;

        if (chatCharacters.length > 0) {
          filterSelectHtml += `<optgroup label="After char">`;
          chatCharacters.forEach(c => {
            const safeName = (c.name || '').replace(/"/g, '&quot;');
            const isSelected = (block.history_filter === 'name' && block.history_filter_name === c.name) ? 'selected' : '';
            filterSelectHtml += `<option value="name:::${safeName}" ${isSelected}>${c.name}</option>`;
          });
          filterSelectHtml += `</optgroup>`;

          // if name is saved, but != group
          if (block.history_filter === 'name' && !chatCharacters.find(c => c.name === block.history_filter_name)) {
            const safeName = (block.history_filter_name || '').replace(/"/g, '&quot;');
            filterSelectHtml += `<optgroup label="Saved Filter"><option value="name:::${safeName}" selected>${block.history_filter_name} (Not in group)</option></optgroup>`;
          }
        } else if (block.history_filter === 'name') {
          const safeName = (block.history_filter_name || '').replace(/"/g, '&quot;');
          filterSelectHtml += `<optgroup label="Saved Filter"><option value="name:::${safeName}" selected>${block.history_filter_name} (Group feature)</option></optgroup>`;
        }

        blocksHtml += `
                <div style="border: 1px dashed rgba(255,255,255,0.2); padding: 8px; border-radius: 5px; background: rgba(0,0,0,0.2); margin-top: 5px;">

                    <!-- role and controls -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">

                        <!-- select -->
                        <select class="text_al wu_block_role" data-step="${activeIndex}" data-block="${origBIndex}"
                            ${block.isCode ? 'disabled' : ''}
                            style="width: auto; padding: 0 5px; color: white; background: ${block.isCode ? 'rgba(255,100,0,0.2)' : 'rgba(0,0,0,0.5)'};">

                            <option value="system" ${block.role === 'system' ? 'selected' : ''}>System</option>
                            <option value="user" ${block.role === 'user' ? 'selected' : ''}>User</option>
                            <option value="assistant" ${block.role === 'assistant' ? 'selected' : ''}>Assistant</option>
                        </select>

                        <div style="display: flex; gap: 6px; align-items: center;">
                            <button class="menu_button wu_expand_block_btn"
                                data-step="${activeIndex}" 
                                data-block="${origBIndex}" 
                                title="Expand Block Details" 
                                style="padding: 1px 8px; font-size: 0.75em; border-color: rgba(0,255,204,0.3); background: rgba(0,255,204,0.1); color: #00ffcc;">
                                <i class="fa-solid fa-expand"></i></button>

                            <!-- JS -->
                            <label title="Not sent to AI prompt"
                                style="display: flex; align-items: center; gap: 4px; font-size: 0.75em; color: #aaa; cursor: pointer; white-space: nowrap;">
                                <input
                                    type="checkbox"
                                    class="wu_block_code"
                                    data-step="${activeIndex}"
                                    data-block="${origBIndex}"
                                    ${block.isCode ? 'checked' : ''}
                                    style="margin: 0; accent-color: #ffcc00;">JS</label>

                            <!-- order input -->
                            <input
                                type="number"
                                class="wu_block_order"
                                data-step="${activeIndex}"
                                data-block="${origBIndex}"
                                min="0"
                                max="255"
                                value="${block.order ?? 128}"
                                title="Block order (0=first, 255=last)"
                                style="width: 55px; background: rgba(0,0,0,0.4); color: white; text-align: center; padding: 2px 4px; font-size: 0.85em;">

                            <button
                                class="menu_button wu_remove_block"
                                data-step="${activeIndex}"
                                data-block="${origBIndex}"
                                style="color: #ff5555;">X</button>
                        </div>
                    </div>

              ${block.isCode ? `<div style="font-size: 0.7em; color: #ffcc00; margin-bottom: 5px;">!!!WARNING - JAVASCRIPT IS FULLY ALLOWED!!!</div>` : ''}

                    <!-- filter for block -->
                    <div style="display: flex; flex-direction: column; gap: 5px; margin-bottom: 5px;">
                        <div style="display: flex; gap: 5px; align-items: center;">
                            <label style="font-size: 0.75em; color: #aaa; min-width: 45px;">Trigger:</label>
                            <select
                                class="text_al wu_block_history_filter"
                                data-step="${activeIndex}"
                                data-block="${origBIndex}"
                                style="width: auto; max-width: 250px; padding: 0 5px; font-size: 0.85em; background: rgba(0,0,0,0.5); color: white;">${filterSelectHtml}</select>
                        </div>

                        <div class="wu_exclude_row" style="display: ${(block.history_filter === 'all' || block.history_filter === 'char') ? 'flex' : 'none'}; gap: 5px; align-items: center;">
                            <label style="font-size: 0.75em; color: #aaa; min-width: 45px;">Except:</label>
                            <input 
                                type="text" 
                                class="text_al wu_block_history_exclude" 
                                data-step="${activeIndex}" 
                                data-block="${origBIndex}" 
                                placeholder="Name1, Name2..." 
                                style="flex: 1; padding: 0 5px; font-size: 0.85em; background: rgba(0,0,0,0.4); color: white; border: 1px solid rgba(255,255,255,0.1);">
                        </div>
                    </div>

                <!-- condition box -->
                    <div class="wu_condition_row" style="display: ${block.history_filter === 'condition'
                    ? 'block'
                    : 'none'};
                        margin-bottom: 5px;">
                        <label style="font-size: 0.7em; color: #ffcc00; display: block; margin-bottom: 2px;">If</label>
                        <textarea 
                            class="text_al wu_block_run_condition_js" 
                            data-step="${activeIndex}" 
                            data-block="${origBIndex}" 
                            style="width: 100%; height: 60px; font-family: monospace; font-size: 0.8em; background: rgba(255, 204, 0, 0.05); color: #ffcc00; border: 1px solid rgba(255, 204, 0, 0.2);"
                            placeholder="return lastMsg.mes.includes('<at>');"></textarea>
                        <label style="font-size: 0.7em; color: #ffcc00; display: block; margin-bottom: 2px;">Then</label>
                    </div>

                    <!-- content -->
                    <textarea
                        class="text_al wu_block_content"
                        data-step="${activeIndex}"
                        data-block="${origBIndex}"
                        rows="3"
                        style="width: 100%; background: rgba(0,0,0,0.4); color: white;">${block.content}</textarea>
                   </div>`;
      });
    }

    container.html(`
        <div style="display: flex; flex-direction: column; gap: 10px;">

            <!-- steps list   -->
            <div style="display: flex; flex-direction: column; gap: 5px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
                <b style="font-size: 0.75em; color: #aaa; margin-bottom: 5px;">Steps</b>

                <div style="display: flex; flex-direction: column; gap: 3px;">
 ${activeProfile.steps.map((step, i) => `
                        <div class="wu_step_tab ${i === activeIndex
                         ? 'active'
                         : ''}"
                            data-index="${i}" title="${step.name}"

                            style="cursor: pointer; padding: 6px 8px; border-radius: 4px; font-size: 0.8em;
                                background: ${i === activeIndex
                                 ? 'rgba(0, 255, 204, 0.2)'
                                 : 'rgba(0,0,0,0.3)'};

                                border: 1px solid ${i === activeIndex
                                 ? '#00ffcc'
                                 : 'rgba(255,255,255,0.1)'};

                                color: ${i === activeIndex ? '#fff' : '#888'}; white-space: nowrap;">${i + 1}. ${step.name || 'Step'}</div>
                                 `).join('')}
                </div>

                <button id="wu_add_step" class="menu_button"
                    style="margin-top: auto; width: 100%; padding: 4px 8px; font-size: 0.8em; font-weight: bold; color: #00ffcc; border-color: rgba(0,255,204,0.3); background: rgba(0,255,204,0.1);">+ Add</button>
            </div>

            <!-- step control bar -->
            <div class="wu_step_controls"
                style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; background: rgba(0,0,0,0.3); padding: 5px; border-radius: 4px; gap: 8px;">

                <div style="display: flex; gap: 5px; align-items: center; flex-grow: 1; min-width: 150px;">
 
                    <input type="checkbox" class="wu_step_enabled" data-step="${activeIndex}" ${currentStep?.enabled
                     ? 'checked'
                     : ''}
                        title="Enable/Disable Step">

                    <input type="text" class="text_al wu_step_name" data-step="${activeIndex}" value="${currentStep?.name}" placeholder="Step name"
                        style="background: rgba(0,0,0,0.4); color: white; flex-grow: 1; min-width: 50px;">
                </div>

                <div style="display: flex; gap: 4px; flex-shrink: 0; align-items: center;">
                     
                    <input type="number" class="wu_step_order" data-step="${activeIndex}" min="0" max="255" value="${currentStep?.order ?? 128}" title="Step order (0=first, 255=last)"
                        style="width: 55px; background: rgba(0,0,0,0.4); color: white; text-align: center; padding: 2px 4px; font-size: 0.85em;">

                    <button class="menu_button wu_remove_step" data-step="${activeIndex}" title="Remove Step"
                        style="color: #ff5555; padding: 0 8px;">X</button>
                </div>
            </div>

            <!-- blocks sect -->
            <div class="wu_blocks_wrapper" data-step="${activeIndex}">

                <button class="menu_button wu_toggle_blocks" data-step="${activeIndex}"
                    style="width: 100%; text-align: center; padding: 4px 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer;">
                    <i class="fa-solid fa-angle-down" style="margin-right: 5px;"></i>
                    <span class="wu_toggle_label">Show</span>
                </button>

                <div class="wu_blocks_container" data-step="${activeIndex}"
                    style="display: none; padding: 5px 0;">

                    ${blocksHtml}

                    <button class="menu_button wu_add_block" data-step="${activeIndex}"
                        style=
                        "margin-top: 8px;
                        padding: 3px 8px;
                        width: 100%;
                        font-weight:
                        bold;">
                        + Add Prompt Block
                    </button>
                </div>
            </div>
                    <button class="menu_button wu_copy_step" data-step="${activeIndex}"
                        style=
                        "margin-top: 5px;
                        padding: 3px 8px;
                        width: 100%;
                        font-weight: bold;
                        font-size: 0.85em;
                        background: rgba(255,255,255,0.05);
                        border: 1px solid rgba(255,255,255,0.1);
                        color: #ccc;">
                        <i class="fa-solid fa-copy" style="margin-right: 5px;"></i>
                        Copy Block List
                    </button>
                </div>
            </div>

                    </div>`);

    $('.wu_block_content').each(function() {
      const s = $(this).data('step');
      const b = $(this).data('block');
      $(this).val(activeProfile.steps[s].blocks[b].content);
    });

    $('.wu_block_run_condition_js').each(function() {
      const s = $(this).data('step');
      const b = $(this).data('block');
      $(this).val(activeProfile.steps[s].blocks[b].run_condition_js);
    });

    $('.wu_block_history_exclude').each(function() {
      const s = $(this).data('step');
      const b = $(this).data('block');
      $(this).val(activeProfile.steps[s].blocks[b].history_exclude);
    });

    $('#wu_step_var_bottom').val(currentStep?.variable_name || '').attr('data-step', activeIndex);
    $('#wu_var_step_label').text(currentStep?.name || `Step ${activeIndex + 1}`);

    $('#wu_last_output').val(currentStep?.last_output || 'No output for this step yet.');
    $('#wu_filter_enabled').prop('checked', !!currentStep?.filter_enabled);

    $('#wu_expected_enabled').prop('checked', !!currentStep?.expected_enabled);
    $('#wu_expected_script').val(currentStep?.expected_script || "return text.trim().length > 0;");

    $('#wu_max_attempts').val(currentStep?.max_attempts ?? 3);

    $('#wu_correction_enabled').prop('checked', !!currentStep?.correction_enabled);
    $('#wu_correction_role').val(currentStep?.correction_role || 'user');

    $('#wu_correction_order').val(currentStep?.correction_order ?? 1);
    $('#wu_correction_content').val(currentStep?.correction_content || 'Your last output:\n{{failed_output}}\n\nIs invalid. Please follow the rules and try again.');

    $('#wu_filter_script').val(currentStep?.filter_script || "return text;");
    $('#wu_history_depth').val(currentStep?.history_depth || 1);

    $('#wu_pre_filter_enabled').prop('checked', !!currentStep?.pre_filter_enabled);
    $('#wu_pre_filter_script').val(currentStep?.pre_filter_script || "return text;");

    $('#wu_advanced_save_enabled').prop('checked', !!currentStep?.advanced_save_enabled);
    $('#wu_advanced_save_script').val(currentStep?.advanced_save_script || '');

    if (currentStep?.advanced_save_enabled) {
      $('#wu_normal_save_container').hide();
      $('#wu_advanced_save_container').show();
      $('#wu_save_text_1').text('Run script after');
      $('#wu_save_text_2').text('output:');
    } else {
      $('#wu_normal_save_container').show();
      $('#wu_advanced_save_container').hide();
      $('#wu_save_text_1').text('Save');
      $('#wu_save_text_2').text('to variable:');
    }
  }

  function updateProfileDropdown() {
    const settings = extensionSettings[MODULE_NAME];
    const currentName = settings.profiles[settings.active_profile]?.name || "—";
    $('#wu_profile_name_display').text(currentName);
    const dropdown = $('#wu_profile_dropdown');
    if (dropdown.is(':visible')) {
      dropdown.empty();
      settings.profiles.forEach((p, i) => {
        const isActive = i === settings.active_profile;
        const item = $(`
                    <div
                        class="wu_profile_item"
                        data-index="${i}"
                        style="padding: 6px 10px; cursor: pointer; font-size: 0.85em; color: #ccc; border-radius: 3px;">
                        ${
                         isActive
                         ? `✓ <span style="color: #00ffcc;">${p.name}</span>`
                         : p.name
                        }
                    </div>
                        `);
        item.on('mouseenter', function() {
          $(this).css('background', 'rgba(255,255,255,0.05)');
        });
        item.on('mouseleave', function() {
          $(this).css('background', 'transparent');
        });
        item.on('click', function(ev) {
          ev.stopPropagation();
          settings.active_profile = i;
          dropdown.hide();
          refreshUI();
          saveSettingsDebounced();
        });
        dropdown.append(item);
      });
    }
  }

  function refreshUI() {
    const settings = extensionSettings[MODULE_NAME];
    const p = settings.profiles[settings.active_profile];

    const isInternal = !!p.use_internal;
    $('#wu_use_internal').prop('checked', isInternal);
    if (isInternal) {
      $('#wu_external_api_settings').hide();
    } else {
      $('#wu_external_api_settings').show();
    }

    $('#wu_api_url').val(p.api_url);
    $('#wu_temp').val(p.temperature);
    $('#wu_freq').val(p.frequency_penalty);
    $('#wu_top_p').val(p.top_p);
    $('#wu_rep_pen').val(p.repeat_penalty);
    $('#wu_pres_pen').val(p.presence_penalty);
    $('#wu_top_k').val(p.top_k);
    $('#wu_min_p').val(p.min_p);
    $('#wu_tokens').val(p.max_tokens);
    $('#wu_profile_notes').val(p.notes || '');
    $('#wu_history_format').val(p.history_format || 'json');

    $('#wu_custom_history_format').val(p.custom_history_format || '{{name}}: {{message}}');
    if (p.history_format === 'custom') {
      $('#wu_custom_history_format_container').show();
    } else {
      $('#wu_custom_history_format_container').hide();
    }

    $('#wu_run_mode').val(p.run_mode || 'after_ai');

    updateProfileDropdown();
    renderSteps();
  }

  function cleanAIResponse(text) {
    if (!text) return "";
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    cleaned = cleaned.replace(/^(Thinking|Thought):[\s\S]*?\n\n/i, "");
    return cleaned.trim();
  }

  function getBlockHistoryText(block, chat, activeProfile, step, depth, override = null) {
    let filteredChat = chat;
    let filterType = block.history_filter || "all";
    let filterName = (block.history_filter_name || "").toLowerCase().trim();
    if (override) {
      const o = override.toLowerCase().trim();
      if (o === "user" || o === "char" || o === "all") {
        filterType = o;
      } else {
        filterType = "name";
        filterName = o;
      }
    }
    if (filterType === "user") {
      filteredChat = filteredChat.filter((m) => m.is_user);
    } else if (filterType === "char") {
      filteredChat = filteredChat.filter((m) => !m.is_user);
    } else if (filterType === "name") {
      filteredChat = filteredChat.filter(
        (m) => (m.name || "").toLowerCase().trim() === filterName
      );
    }
    filteredChat = filteredChat.slice(
      Math.max(0, filteredChat.length - depth),
    );

    let filterFn = (t) => t;
    if (
      step.pre_filter_enabled &&
      step.pre_filter_script?.trim()
    ) {
      try {
        filterFn = new Function(
          "text",
          step.pre_filter_script,
        );
      } catch (e) {
        console.warn("World Updater: Pre-filter syntax error:", e, );
      }
    }

    const processedMessages = filteredChat.map((m) => {
      let filteredContent = m.mes;
      try {
        const result = filterFn(m.mes);
        if (typeof result === "string")
          filteredContent = result;
      } catch (e) {
        console.error("World Updater: Pre-filter runtime error:", e, );
      }
      return {
        name: m.name,
        mes: filteredContent
      };
    });

    if (activeProfile.history_format === "json") {
      return JSON.stringify(
        processedMessages.map((m) => ({
          character: m.name,
          text: m.mes,
        })),
        null,
        2,
      );
    } else if (activeProfile.history_format === "mkd") {
      return processedMessages
        .map((m) => `### ${m.name}\n${m.mes}`)
        .join("\n\n---\n\n");
    } else if (activeProfile.history_format === "custom") {
      const formatStr =
        activeProfile.custom_history_format ||
        "{{name}}: {{message}}";
      return processedMessages
        .map((m) =>
          formatStr
          .replace(/{{name}}/gi, () => m.name)
          .replace(/{{message}}/gi, () => m.mes),
        )
        .join("\n\n");
    } else {
      return processedMessages
        .map((m) => m.name + ": " + m.mes)
        .join("\n\n");
    }
  };

  async function handleUpdate(abortSignal = null) {
    if (isUpdating) return;
    const runBtn = $('#wu_force_run');
    runBtn.prop('disabled', true);

    const isExternalAbort = !!abortSignal;
    if (!isExternalAbort) {
      abortController = new AbortController();
      abortSignal = abortController.signal;
    }

    isUpdating = true;
    updateRunButton(true);
    // end of it was not changing the button i guess
    try {
      const settings = extensionSettings[MODULE_NAME];
      const activeProfile = settings.profiles[settings.active_profile];

      const chat = SillyTavern.getContext().chat;

      if (!chat || chat.length === 0) {
        return;
      }

      const lastMessage = chat[chat.length - 1];
      if (!lastMessage.mes || lastMessage.mes.trim() === "") {
        return;
      }

      let previousOutput = "";
      let wasAborted = false;

      // loop through the chain steps
      for (let sIndex = 0; sIndex < activeProfile.steps.length; sIndex++) {
        const step = activeProfile.steps[sIndex];
        const depth = Number(step.history_depth) || 1;
        if (abortSignal.aborted) {
          wasAborted = true;
          step.last_output =
            (step.last_output || "") +
            "\n\n[⏹ Chain was stopped by user]";
          if (sIndex === settings.active_step_index) {
            $("#wu_last_output").val(step.last_output);
          }
          break;
        }

        if (!step.enabled) continue; // skip disabled steps

        let resultText = "";
        let failedAttempts = [];
        const maxAttempts = step.max_attempts !== undefined ? parseInt(step.max_attempts) : 3;

        for (let attempt = 0; maxAttempts === 0 || attempt < maxAttempts; attempt++) {
          if (abortSignal.aborted) break;

          const stContext = SillyTavern.getContext();

          // identify the last speaker
          const lastMsg = chat[chat.length - 1];
          const lastSpeakerName = (lastMsg.name || "")
            .toLowerCase()
            .trim();
          const isLastMsgUser = lastMsg.is_user;

          const sortedBlocks = [...step.blocks]
            .sort((a, b) => (a.order || 128) - (b.order || 128))
            .filter((block) => {
              if (block.history_exclude && block.history_exclude.trim() !== "" && block.history_filter !== "condition") {
                const excludeList = block.history_exclude
                  .split(",")
                  .map((name) => name.trim().toLowerCase());
                if (excludeList.includes(lastSpeakerName))
                  return false;
              }

              if (block.history_filter === "user")
                return isLastMsgUser;
              if (block.history_filter === "char")
                return !isLastMsgUser;
              if (block.history_filter === "name") {
                const target = (block.history_filter_name || "")
                  .toLowerCase()
                  .trim();
                return !isLastMsgUser && lastSpeakerName === target;
              }
              if (block.history_filter === "condition") {
                try {
                  const historyString = getBlockHistoryText(block, chat, activeProfile, step, depth);
                  const condFunc = new Function(
                    "chat",
                    "lastMsg",
                    "variables",
                    "previous_output",
                    "substituteParams",
                    "chat_history",
                    block.run_condition_js,
                  );
                  const result = condFunc(
                    chat,
                    lastMsg,
                    stContext.chatMetadata?.variables || {},
                    previousOutput,
                    substituteParams,
                    historyString,
                  );
                  return !!result;
                } catch (e) {
                  console.warn("World Updater: Trigger Condition Error in Step " + (sIndex + 1) + ":", e, );
                  return false;
                }
              }
              return true;
            });

          let dynamicBlocks = [...sortedBlocks];
          if (attempt > 0 && step.correction_enabled && step.correction_content) {
            const failed_output = failedAttempts[failedAttempts.length - 1] || "";
            const correctedContent = step.correction_content
              .replace(/{{failed_output}}/g, failed_output)
              .replace(/{{previous_output}}/g, previousOutput);

            dynamicBlocks.push({
              role: step.correction_role || "user",
              content: correctedContent,
              order: step.correction_order ?? 1,
              isCode: false,
            });
            dynamicBlocks.sort((a, b) => (a.order || 128) - (b.order || 128));
          }

          const codeBlocks = dynamicBlocks.filter((b) => b.isCode);
          const textBlocks = dynamicBlocks.filter((b) => !b.isCode);

          for (const block of codeBlocks) {
            try {
              const blockHistoryText = getBlockHistoryText(block, chat, activeProfile, step, depth);
              const codeFunc = new AsyncFunction(
                "previous_output",
                "chat_history",
                "mes",
                "variables",
                "substituteParams",
                block.content + "\n\n//# sourceURL=wu_code_block",
              );
              const result = await codeFunc(
                previousOutput,
                blockHistoryText,
                chat[chat.length - 1].mes,
                stContext.chatMetadata?.variables || {},
                substituteParams,
              );
              if (result !== undefined) {
                previousOutput = String(result);
              }
            } catch (e) {
              console.error(`[World Updater] Code block error in step ${sIndex + 1}:`, e, );
              previousOutput = `/* CODE ERROR: ${e.message} */`;
            }
          }

          const finalPrompt = (await Promise.all(textBlocks.map(async (block) => {
            let res = await substituteParams(block.content);
            res = res
              .replace(
                /{{chat_history(?:(?:::)([^}]+))?}}/g,
                (match, arg) => {
                  const cleanArg = arg ? arg.trim() : null;
                  return getBlockHistoryText(block, chat, activeProfile, step, depth, cleanArg);
                },
              )
              .replace(
                /{{mes}}/g,
                () => chat[chat.length - 1].mes,
              )
              .replace(
                /{{previous_output}}/g,
                () => previousOutput,
              );

            return res;
          }))).join("\n\n");

          try {
            resultText = "";

            if (activeProfile.use_internal) {
              if (textBlocks.length > 0) {
                const generatePromise = generateRaw({
                  prompt: finalPrompt,
                  max_tokens: parseInt(activeProfile.max_tokens) || 50,
                  temperature: Number(activeProfile.temperature),
                  top_p: Number(activeProfile.top_p),
                  top_k: Number(activeProfile.top_k),
                  min_p: Number(activeProfile.min_p),
                  rep_pen: Number(activeProfile.repeat_penalty),
                  presence_penalty: Number(
                    activeProfile.presence_penalty,
                  ),
                  signal: abortSignal,
                });

                let abortHandler;
                const abortPromise = new Promise((_, reject) => {
                  if (abortSignal.aborted) return reject(new DOMException("Aborted", "AbortError"));
                  abortHandler = () => reject(new DOMException("Aborted", "AbortError"));
                  abortSignal.addEventListener("abort", abortHandler);
                });

                const rawInternalText = await Promise.race([
                  generatePromise,
                  abortPromise,
                ]).finally(() => {
                  if (abortHandler) abortSignal.removeEventListener("abort", abortHandler);
                });
                const cleanedInternal = cleanAIResponse(rawInternalText || "");
                resultText = cleanedInternal || previousOutput || "";
              } else {
                resultText = previousOutput;
              }
            } else {
              if (textBlocks.length > 0) {
                const headers = {
                  "Content-Type": "application/json",
                };
                if (activeProfile.api_key)
                  headers["Authorization"] =
                  `Bearer ${activeProfile.api_key}`;

                const apiMessages = await Promise.all(textBlocks.map(async (b) => {
                  let res = await substituteParams(b.content);
                  res = res
                    .replace(
                      /{{chat_history(?:(?:::)([^}]+))?}}/g,
                      (match, arg) => {
                        const cleanArg = arg ?
                          arg.trim() :
                          null;
                        return getBlockHistoryText(b, chat, activeProfile, step, depth, cleanArg);
                      },
                    )
                    .replace(
                      /{{mes}}/g,
                      () => chat[chat.length - 1].mes,
                    )
                    .replace(
                      /{{previous_output}}/g,
                      () => previousOutput,
                    );

                  return {
                    role: b.role,
                    content: res,
                  };
                }));

                const lastBlock = apiMessages[apiMessages.length - 1];
                if (lastBlock?.role === "user" && lastBlock.content.trim().endsWith("Result:[")) {
                  const content = lastBlock.content.trim();
                  lastBlock.content = content.slice(0, -1) + ":";

                  apiMessages.push({
                    role: "assistant",
                    content: "[",
                  });
                }

                const response = await fetch(
                  activeProfile.api_url, {
                    method: "POST",
                    headers: headers,
                    signal: abortSignal,
                    body: JSON.stringify({
                      model: activeProfile.model || "auto",
                      messages: apiMessages,
                      max_tokens: parseInt(
                        activeProfile.max_tokens,
                      ) || 50,
                      temperature: Number(
                        activeProfile.temperature,
                      ),
                      top_p: Number(activeProfile.top_p),
                      top_k: Number(activeProfile.top_k),
                      min_p: Number(activeProfile.min_p),
                      repeat_penalty: Number(
                        activeProfile.repeat_penalty,
                      ),
                      presence_penalty: Number(
                        activeProfile.presence_penalty,
                      ),
                      frequency_penalty: Number(
                        activeProfile.frequency_penalty,
                      ),
                      stream: true, // streaming
                    }),
                  },
                );

                if (!response.ok) {
                  throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
                }

                let rawText = "";
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let buffer = ""; // buffer
                while (true) {
                  const {
                    done,
                    value
                  } = await reader.read();
                  if (done) {
                    if (buffer.trim()) {
                      const leftoverLines = buffer.split("\n");
                      for (const line of leftoverLines) {
                        if (line.trim().startsWith("data: ") && line.trim() !== "data: [DONE]") {
                          try {
                            const parsed = JSON.parse(line.trim().substring(6));
                            if (parsed.choices?.[0]?.delta?.content) {
                              rawText += parsed.choices[0].delta.content;
                            } else if (parsed.results?.[0]?.text) {
                              rawText += parsed.results[0].text;
                            }
                          } catch (e) {}
                        }
                      }
                    }
                    break;
                  }
                  buffer += decoder.decode(value, {
                    stream: true,
                  });
                  const lines = buffer.split("\n");
                  buffer = lines.pop();

                  for (const line of lines) {
                    if (line.trim().startsWith("data: ")) {
                      const dataStr = line
                        .trim()
                        .substring(6);
                      if (dataStr === "[DONE]") continue;
                      try {
                        const parsed = JSON.parse(dataStr);
                        if (
                          parsed.choices?.[0]?.delta
                          ?.content
                        ) {
                          rawText +=
                            parsed.choices[0].delta
                            .content;
                        } else if (
                          parsed.results?.[0]?.text
                        ) {
                          rawText +=
                            parsed.results[0].text;
                        }
                      } catch (err) {}
                    }
                  }
                }
                const cleaned = cleanAIResponse(rawText);
                resultText = cleaned || previousOutput;
                if (lastBlock?.role === "assistant") {
                  if (!resultText.startsWith("[")) {
                    resultText = "[" + resultText;
                  }
                }
              } else {
                resultText = previousOutput;
              }
            }

            // filter
            if (step.filter_enabled && step.filter_script && step.filter_script.trim() !== "") {
              try {
                const filterFunc = new Function("text", step.filter_script);
                const filteredText = filterFunc(resultText);

                if (typeof filteredText === "string") {
                  resultText = filteredText;
                } else {
                  console.warn("World Updater: Filter didn't return a string, using raw text.");
                }
              } catch (err) {
                console.error("World Updater Filter Error:", err);
                toastr.error(`Filter Error in Step ${sIndex + 1}. Check console.`);
              }
            }

            // validation check start
            if (textBlocks.length > 0 && step.expected_enabled && step.expected_script?.trim()) {
              try {
                const expectedFunc = new Function(
                  "text",
                  "previous_output",
                  "variables",
                  step.expected_script,
                );
                const isValid = expectedFunc(
                  resultText,
                  previousOutput,
                  stContext.chatMetadata?.variables || {},
                );
                if (isValid) {
                  break;
                } else {
                  wu_log(
                    `Step ${sIndex + 1} failed validation on attempt ${attempt + 1}`,
                  );
                  failedAttempts.push(resultText);
                  if (maxAttempts !== 0 && attempt === maxAttempts - 1) {
                    toastr.warning(`!STEP ${sIndex + 1} FAILED AFTER MAX RETRIES`, );
                  } else {
                    toastr.error("!NOT EXPECTED; AI WILL RETRY");
                  }
                }
              } catch (err) {
                console.error("Expected script error:", err);
                break;
              }
            } else {
              break;
            }
          } catch (e) {
            if (e.name === "AbortError") {
              wasAborted = true;
              console.log("World Updater: Chain update aborted by user.", );
              break;
            } else {
              console.error(`[World Updater] Error in Step ${sIndex + 1}:`, e, );
              break;
            }
          }
        }

        if (wasAborted) break;

        previousOutput = resultText;
        step.last_output = resultText;

        if (sIndex === settings.active_step_index) {
          $("#wu_last_output").val(resultText);
        }

        // save to char variable OR executes a script
        if (step.advanced_save_enabled && step.advanced_save_script?.trim()) {
          try {
            console.log(`World Updater: Running Advanced Script for Step ${sIndex + 1}`, );
            const advFunc = new AsyncFunction(
              "resultText",
              "context",
              "substituteParams",
              "toastr",
              step.advanced_save_script,
            );
            await advFunc(
              resultText,
              SillyTavern.getContext(),
              substituteParams,
              window.toastr,
            );
          } catch (err) {
            console.error(`World Updater: Advanced script error in step ${sIndex + 1}:`, err, );
            window.toastr.error(`JS Error (Step ${sIndex + 1}): ${err.message}`, );
          }
        } else if (step.variable_name && step.variable_name.trim() !== "") {
          const varName = step.variable_name.trim();
          const stContext = SillyTavern.getContext();
          if (stContext.chatMetadata) {
            if (typeof stContext.chatMetadata.variables !== "object") {
              stContext.chatMetadata.variables = {};
            }
            stContext.chatMetadata.variables[varName] = resultText;
            if (typeof stContext.saveMetadata === "function") {
              await stContext.saveMetadata();
            }
          }
        }
      }

      if (wasAborted) {
        try {
          const stContext = SillyTavern.getContext();
          if (typeof stContext.abortController?.abort === "function") {
            stContext.abortController.abort();
          }
          if (typeof window.stopGeneration === "function") {
            window.stopGeneration();
          }
          if (typeof window.api?.stopGeneration === "function") {
            await window.api.stopGeneration();
          }
        } catch (e) {
          console.debug("World Updater: Could not stop main generation:", e, );
        }
      }

      if (typeof context.saveChatDebounced === "function") {
        context.saveChatDebounced();
      }
      saveSettingsDebounced();
      return wasAborted ? 'aborted' : 'success';
    } finally {
      isUpdating = false;
      abortController = null;
      updateRunButton(false);
      $('#wu_force_run').prop('disabled', false);
    }
  }


  async function setupUI() {
    loadSettings();
    const settings = extensionSettings[MODULE_NAME];

    const updateActiveProfile = (key, val) => {
      settings.profiles[settings.active_profile][key] = val;
      saveSettingsDebounced();
    };

    const html = await renderExtensionTemplateAsync('third-party/world-updater', 'settings', settings);
    $('#extensions_settings').append(html);

    refreshUI();
    toggleRunButtonVisibility();

    $(document).off('change', '#wu_run_mode').on('change', '#wu_run_mode', (e) => {
      updateActiveProfile('run_mode', $(e.target).val());
    });

    // pre-filter events
    $(document).off('click', '#wu_toggle_pre_filter').on('click', '#wu_toggle_pre_filter', () => {
      $('#wu_pre_filter_container').toggle();
    });
    $(document).off('change', '#wu_pre_filter_enabled').on('change', '#wu_pre_filter_enabled', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.pre_filter_enabled = $(e.target).is(':checked');
        saveSettingsDebounced();
      }
    });
    $(document).off('input', '#wu_pre_filter_script').on('input', '#wu_pre_filter_script', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.pre_filter_script = $(e.target).val();
        saveSettingsDebounced();
      }
    });

    $(document).off('change', '#wu_use_internal').on('change', '#wu_use_internal', (e) => {
      updateActiveProfile('use_internal', $(e.target).is(':checked'));
      refreshUI();
    });

    $(document).off('change', '#wu_history_format').on('change', '#wu_history_format', (e) => {
      updateActiveProfile('history_format', $(e.target).val());
      if ($(e.target).val() === 'custom') {
        $('#wu_custom_history_format_container').show();
      } else {
        $('#wu_custom_history_format_container').hide();
      }
    });

    $(document).off('input', '#wu_custom_history_format').on('input', '#wu_custom_history_format', (e) => {
      updateActiveProfile('custom_history_format', $(e.target).val());
    });

    // profile inputs
    $(document).off('click', '#wu_profile_name_btn').on('click', '#wu_profile_name_btn', function(e) {
      e.stopPropagation();
      const dropdown = $('#wu_profile_dropdown');

      if (dropdown.is(':visible')) {
        dropdown.hide();
        return;
      }

      const settings = extensionSettings[MODULE_NAME];
      dropdown.empty();

      settings.profiles.forEach((p, i) => {
        const isActive = i === settings.active_profile;
        const item = $(`
                    <div class="wu_profile_item" data-index="${i}" style="padding: 6px 10px; cursor: pointer; font-size: 0.85em; color: #ccc; border-radius: 3px;">
                        ${isActive ? '✓ <span style="color: #00ffcc;">' + p.name + '</span>' : p.name}
                    </div>
                           `);

        item.on('mouseenter', function() {
          $(this).css('background', 'rgba(255,255,255,0.05)');
        });
        item.on('mouseleave', function() {
          $(this).css('background', 'transparent');
        });
        item.on('click', function(ev) {
          ev.stopPropagation();
          settings.active_profile = i;
          dropdown.hide();
          refreshUI();
          saveSettingsDebounced();
        });

        dropdown.append(item);
      });

      dropdown.show();
    });

    $(document).on('click.wu_profile_close', function(e) {
      if (!$(e.target).closest('#wu_profile_name_btn, #wu_profile_dropdown').length) {
        $('#wu_profile_dropdown').hide();
      }
    });

    $(document).off('click', '#wu_rename_profile').on('click', '#wu_rename_profile', () => {
      const settings = extensionSettings[MODULE_NAME];
      const currentName = settings.profiles[settings.active_profile].name;
      const newName = prompt("Rename profile to:", currentName);
      if (newName !== null && newName.trim() !== "") {
        settings.profiles[settings.active_profile].name = newName.trim();
        refreshUI();
        saveSettingsDebounced();
        toastr.success("PROFILE RENAMED TO: " + newName.trim());
      }
    });

    $(document).off('click', '#wu_new_profile').on('click', '#wu_new_profile', () => {
      const newP = JSON.parse(JSON.stringify(defaultProfile));
      newP.name = "New Profile";
      settings.profiles.push(newP);
      settings.active_profile = settings.profiles.length - 1;
      refreshUI();
      saveSettingsDebounced();
    });

    $(document).off('click', '#wu_del_profile').on('click', '#wu_del_profile', () => {
      if (settings.profiles.length <= 1) {
        toastr.warning("!CANT DELETE YOUR ONLY PROFILE");
        return;
      }
      settings.profiles.splice(settings.active_profile, 1);
      settings.active_profile = 0;
      refreshUI();
      saveSettingsDebounced();
    });

    // import and export
    $(document).off('click', '#wu_export_profile').on('click', '#wu_export_profile', () => {
      const settings = extensionSettings[MODULE_NAME];
      const p = settings.profiles[settings.active_profile];
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(p, null, 4));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      const safeName = (p.name || "profile").replace(/[^a-z0-9]/gi, '_').toLowerCase();
      downloadAnchorNode.setAttribute("download", "wu_profile_" + safeName + ".json");
      document.body.appendChild(downloadAnchorNode); // gecko
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });

    $(document).off('click', '#wu_import_profile').on('click', '#wu_import_profile', () => {
      $('#wu_import_profile_input').click();
    });

    $(document).off('change', '#wu_import_profile_input').on('change', '#wu_import_profile_input', function(e) {
      const file = e.target.files[0];
      if (!file) {
        $(this).val('');
        return;
      }
      const reader = new FileReader();
      reader.onload = function(ev) {
        try {
          const importedProfile = JSON.parse(ev.target.result);
          if (!importedProfile.steps || !Array.isArray(importedProfile.steps)) {
            throw new Error("Invalid profile format. 'steps' array is missing.");
          }
          const settings = extensionSettings[MODULE_NAME];
          importedProfile.name = (importedProfile.name || "Imported Profile") + " (Imported)";

          settings.profiles.push(importedProfile);
          settings.active_profile = settings.profiles.length - 1;
          loadSettings();
          refreshUI();
          saveSettingsDebounced();
        } catch (err) {
          console.error("World Updater: Import failed:", err);
          toastr.error("!FAILED TO IMPORT PROFILE: " + err.message);
        } finally {
          $('#wu_import_profile_input').val('');
        }
      };
      reader.readAsText(file);
    });

    // import and export end

    $(document).off('click', '#wu_clear_variable').on('click', '#wu_clear_variable', async (e) => {
      const varInput = $('#wu_step_var_bottom');
      const varName = varInput.val().trim();

      if (!varName) {
        toastr.info("!NO VARIABLE NAME TO CLEAR");
        return;
      }

      const stContext = SillyTavern.getContext();
      if (stContext.chatMetadata?.variables && stContext.chatMetadata.variables[varName] !== undefined) {
        delete stContext.chatMetadata.variables[varName];
        await stContext.saveMetadata();
      } else {
        toastr.info(`"${varName}" DOES NOT EXIST`);
        return;
      }

      const stepIdx = varInput.attr('data-step');
      toastr.success(`"${varName}" CLEARED SUCCESSFULLY`);
    });

    // show/hide for prompt blocks
    $(document).off('click', '.wu_toggle_blocks').on('click', '.wu_toggle_blocks', function() {
      const stepIdx = $(this).data('step');
      const wrapper = $(`.wu_blocks_wrapper[data-step="${stepIdx}"]`);
      const container = wrapper.find('.wu_blocks_container');
      const icon = $(this).find('i');
      const label = $(this).find('.wu_toggle_label');

      container.toggle();

      if (container.is(':visible')) {
        icon.removeClass('fa-angle-down').addClass('fa-angle-up');
        label.text('Hide');
      } else {
        icon.removeClass('fa-angle-up').addClass('fa-angle-down');
        label.text('Show');
      }
    });

    $(document).off('input', '#wu_api_url').on('input', '#wu_api_url', (e) => updateActiveProfile('api_url', $(e.target).val()));
    $(document).off('input', '#wu_temp').on('input', '#wu_temp', (e) => updateActiveProfile('temperature', $(e.target).val()));
    $(document).off('input', '#wu_freq').on('input', '#wu_freq', (e) => updateActiveProfile('frequency_penalty', $(e.target).val()));
    $(document).off('input', '#wu_top_p').on('input', '#wu_top_p', (e) => updateActiveProfile('top_p', $(e.target).val()));
    $(document).off('input', '#wu_rep_pen').on('input', '#wu_rep_pen', (e) => updateActiveProfile('repeat_penalty', $(e.target).val()));
    $(document).off('input', '#wu_pres_pen').on('input', '#wu_pres_pen', (e) => updateActiveProfile('presence_penalty', $(e.target).val()));
    $(document).off('input', '#wu_tokens').on('input', '#wu_tokens', (e) => updateActiveProfile('max_tokens', $(e.target).val()));

    $(document).off('input', '#wu_history_depth').on('input', '#wu_history_depth', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.history_depth = $(e.target).val();
        saveSettingsDebounced();
      }
    });

    $(document).off('input', '#wu_top_k').on('input', '#wu_top_k', (e) => updateActiveProfile('top_k', $(e.target).val()));
    $(document).off('input', '#wu_min_p').on('input', '#wu_min_p', (e) => updateActiveProfile('min_p', $(e.target).val()));

    // step n chain management
    $(document).off('click', '#wu_add_step').on('click', '#wu_add_step', () => {
      const p = settings.profiles[settings.active_profile];
      p.steps.push({
        name: `Step ${p.steps.length + 1}`,
        variable_name: '',
        history_depth: 1,
        pre_filter_enabled: false,
        pre_filter_script: "return text;",
        enabled: true,
        order: 128,
        filter_enabled: false,
        filter_script: "return text;",
        blocks: [{
          role: 'system',
          content: '',
          order: 128,
          isCode: false,
          history_filter: 'all',
          history_filter_name: ''
        }]
      });
      settings.active_step_index = p.steps.length - 1;

      renderSteps();
      saveSettingsDebounced();
    });

    $(document).off('click', '.wu_remove_step').on('click', '.wu_remove_step', (e) => {
      const p = settings.profiles[settings.active_profile];
      const stepIdx = parseInt($(e.currentTarget).attr('data-step'), 10);
      const step = p.steps[stepIdx];

      if (step.enabled) {
        toastr.warning("!DISABLE THE STEP FIRST");
        return;
      }

      p.steps.splice(stepIdx, 1);

      if (settings.active_step_index >= p.steps.length) {
        settings.active_step_index = Math.max(0, p.steps.length - 1);
      }

      renderSteps();
      saveSettingsDebounced();
    });

    $(document).off('change', '.wu_step_order').on('change', '.wu_step_order', (e) => {
      const stepIdx = parseInt($(e.currentTarget).attr('data-step'), 10);
      const newOrder = parseInt($(e.target).val()) || 128;
      const p = settings.profiles[settings.active_profile];
      p.steps[stepIdx].order = Math.max(0, Math.min(255, newOrder));
      const activeStepBeforeSort = p.steps[settings.active_step_index];
      p.steps.sort((a, b) => (a.order || 128) - (b.order || 128));
      if (activeStepBeforeSort) {
        settings.active_step_index = p.steps.indexOf(activeStepBeforeSort);
      }
      saveSettingsDebounced();
    });

    $(document).off('click', '.wu_step_tab').on('click', '.wu_step_tab', (e) => {
      const newIndex = parseInt($(e.currentTarget).attr('data-index'), 10);
      settings.active_step_index = newIndex;
      renderSteps();
      saveSettingsDebounced();
    });

    $(document).off('input', '.wu_step_name').on('input', '.wu_step_name', (e) => {
      const stepIdx = parseInt($(e.currentTarget).attr('data-step'), 10);
      const newName = $(e.target).val();
      settings.profiles[settings.active_profile].steps[stepIdx].name = newName;

      $(`.wu_step_tab[data-index="${stepIdx}"]`).text(`${stepIdx + 1}. ${newName || 'Step'}`);

      saveSettingsDebounced();
    });

    $(document).off('input', '#wu_step_var_bottom').on('input', '#wu_step_var_bottom', (e) => {
      const stepIdx = parseInt($(e.currentTarget).attr('data-step'), 10);
      settings.profiles[settings.active_profile].steps[stepIdx].variable_name = $(e.target).val();
      saveSettingsDebounced();
    });

    $(document).off('change', '.wu_step_enabled').on('change', '.wu_step_enabled', (e) => {
      const stepIdx = parseInt($(e.currentTarget).attr('data-step'), 10);
      settings.profiles[settings.active_profile].steps[stepIdx].enabled = $(e.target).is(':checked');
      saveSettingsDebounced();
    });

    // block management

    // only one step
    $(document).off('click', '.wu_copy_step').on('click', '.wu_copy_step', async function(e) {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const settings = extensionSettings[MODULE_NAME];
      const step = settings.profiles[settings.active_profile].steps[sIndex];
      const textToCopy = formatStepForExport(step, sIndex, true);
      
      try {
        await navigator.clipboard.writeText(textToCopy);
        toastr.success(`Copied Block List for Step ${sIndex + 1}!`);
      } catch (err) {
        console.error("World Updater copy failed:", err);
        toastr.error("Failed to copy blocks. Check console.");
      }
    });

    // all steps
    $(document).off('click', '#wu_copy_all_steps').on('click', '#wu_copy_all_steps', async function() {
      const settings = extensionSettings[MODULE_NAME];
      const steps = settings.profiles[settings.active_profile].steps;
      let textToCopy = "";
      
      steps.forEach((step, idx) => {
        textToCopy += formatStepForExport(step, idx, false);
      });
      
      try {
        await navigator.clipboard.writeText(textToCopy);
        toastr.success("Copied All Steps to clipboard!");
      } catch (err) {
        console.error("World Updater copy failed:", err);
        toastr.error("Failed to copy all steps. Check console.");
      }
    });

    $(document).off('click', '.wu_add_block').on('click', '.wu_add_block', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      settings.profiles[settings.active_profile].steps[sIndex].blocks.push({
        role: 'system',
        content: '',
        order: 128,
        isCode: false,
        history_filter: 'all',
        history_filter_name: ''
      });
      renderSteps();
      saveSettingsDebounced();
    });

    $(document).off('click', '.wu_remove_block').on('click', '.wu_remove_block', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const bIndex = parseInt($(e.currentTarget).attr('data-block'), 10);
      settings.profiles[settings.active_profile].steps[sIndex].blocks.splice(bIndex, 1);
      renderSteps();
      saveSettingsDebounced();
    });

    $(document).off('change', '.wu_block_order').on('change', '.wu_block_order', (e) => {
      const stepIdx = parseInt($(e.currentTarget).attr('data-step'), 10);
      const blockIdx = parseInt($(e.currentTarget).attr('data-block'), 10);
      const newOrder = parseInt($(e.target).val()) || 128;
      settings.profiles[settings.active_profile].steps[stepIdx].blocks[blockIdx].order = Math.max(0, Math.min(255, newOrder));
      saveSettingsDebounced();
    });

    $(document).off('change', '.wu_block_role').on('change', '.wu_block_role', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const bIndex = parseInt($(e.currentTarget).attr('data-block'), 10);
      settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].role = $(e.target).val();
      saveSettingsDebounced();
    });

    $(document).off('change', '.wu_block_code').on('change', '.wu_block_code', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const bIndex = parseInt($(e.currentTarget).attr('data-block'), 10);
      settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].isCode = $(e.currentTarget).is(':checked');
      saveSettingsDebounced();
    });

    $(document).off('input', '.wu_block_content').on('input', '.wu_block_content', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const bIndex = parseInt($(e.currentTarget).attr('data-block'), 10);
      settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].content = $(e.target).val();
      saveSettingsDebounced();
    });

    $(document).off('input', '.wu_block_history_exclude').on('input', '.wu_block_history_exclude', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const bIndex = parseInt($(e.currentTarget).attr('data-block'), 10);
      settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].history_exclude = $(e.target).val();
      saveSettingsDebounced();
    });

    $(document).off('change', '.wu_block_history_filter').on('change', '.wu_block_history_filter', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const bIndex = parseInt($(e.currentTarget).attr('data-block'), 10);
      const val = $(e.target).val();

      if (val.startsWith('name:::')) {
        settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].history_filter = 'name';
        settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].history_filter_name = val.substring(7);
      } else {
        settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].history_filter = val;
        settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].history_filter_name = '';
      }

      renderSteps();
      saveSettingsDebounced();
    });

    $(document).off('input', '.wu_block_run_condition_js').on('input', '.wu_block_run_condition_js', (e) => {
      const sIndex = parseInt($(e.currentTarget).attr('data-step'), 10);
      const bIndex = parseInt($(e.currentTarget).attr('data-block'), 10);
      settings.profiles[settings.active_profile].steps[sIndex].blocks[bIndex].run_condition_js = $(e.target).val();
      saveSettingsDebounced();
    });

    // filter menu
    $(document).off('click', '#wu_toggle_filter').on('click', '#wu_toggle_filter', () => {
      $('#wu_filter_container').toggle();
    });

    // save
    $(document).off('change', '#wu_filter_enabled').on('change', '#wu_filter_enabled', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.filter_enabled = $(e.target).is(':checked');
        saveSettingsDebounced();
      }
    });

    $(document).off('input', '#wu_filter_script').on('input', '#wu_filter_script', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.filter_script = $(e.target).val();
        saveSettingsDebounced();
      }
    });

    // expected
    $(document).off('click', '#wu_toggle_expected').on('click', '#wu_toggle_expected', () => {
      $('#wu_expected_container').toggle();
    });

    $(document).off('change', '#wu_expected_enabled').on('change', '#wu_expected_enabled', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.expected_enabled = $(e.target).is(':checked');
        saveSettingsDebounced();
      }
    });

    $(document).off('input', '#wu_expected_script').on('input', '#wu_expected_script', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.expected_script = $(e.target).val();
        saveSettingsDebounced();
      }
    });

    $(document).off('input', '#wu_max_attempts').on('input', '#wu_max_attempts', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.max_attempts = parseInt($(e.target).val()) || 0;
        saveSettingsDebounced();
      }
    });

    $(document).off('change', '#wu_correction_enabled').on('change', '#wu_correction_enabled', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.correction_enabled = $(e.target).is(':checked');
        saveSettingsDebounced();
      }
    });

    $(document).off('change', '#wu_correction_role').on('change', '#wu_correction_role', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.correction_role = $(e.target).val();
        saveSettingsDebounced();
      }
    });

    $(document).off('input', '#wu_correction_order').on('input', '#wu_correction_order', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.correction_order = parseInt($(e.target).val()) || 1;
        saveSettingsDebounced();
      }
    });

    $(document).off('input', '#wu_correction_content').on('input', '#wu_correction_content', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.correction_content = $(e.target).val();
        saveSettingsDebounced();
      }
    });

    // expected end

    $(document).off('change', '#wu_advanced_save_enabled').on('change', '#wu_advanced_save_enabled', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        const isChecked = $(e.target).is(':checked');
        step.advanced_save_enabled = isChecked;
        saveSettingsDebounced();
        $('#wu_normal_save_container').toggle(!isChecked);
        $('#wu_advanced_save_container').toggle(isChecked);
        if (isChecked) {
          $('#wu_save_text_1').text('Run script after');
          $('#wu_save_text_2').text('output:');
        } else {
          $('#wu_save_text_1').text('Save');
          $('#wu_save_text_2').text('to variable:');
        }
      }
    });

    $(document).off('input', '#wu_advanced_save_script').on('input', '#wu_advanced_save_script', (e) => {
      const step = settings.profiles[settings.active_profile].steps[settings.active_step_index];
      if (step) {
        step.advanced_save_script = $(e.target).val();
        saveSettingsDebounced();
      }
    });

    // macro
    $(document).off('click', '#wu_toggle_macros').on('click', '#wu_toggle_macros', function() {
      const container = $('#wu_macros_container');
      const icon = $(this).find('i');

      container.toggle();

      if (container.is(':visible')) {
        icon.removeClass('fa-angle-down').addClass('fa-angle-up');
      } else {
        icon.removeClass('fa-angle-up').addClass('fa-angle-down');
      }
    });

    // API setts toggle
    $(document).off('click', '#wu_toggle_settings').on('click', '#wu_toggle_settings', function() {
      const container = $('#wu_settings_container');
      const icon = $(this).find('i');

      container.toggle();

      if (container.is(':visible')) {
        icon.removeClass('fa-angle-down').addClass('fa-angle-up');
      } else {
        icon.removeClass('fa-angle-up').addClass('fa-angle-down');
      }
    });

    // notes
    $(document).off('input', '#wu_profile_notes').on('input', '#wu_profile_notes', function() {
      const settings = extensionSettings[MODULE_NAME];
      const p = settings.profiles[settings.active_profile];
      p.notes = $(this).val();
      saveSettingsDebounced();
    });

    // output box
    $(document).off('change', '#wu_last_output').on('change', '#wu_last_output', async (e) => {
      const p = settings.profiles[settings.active_profile];
      const step = p.steps[settings.active_step_index];
      if (!step) return;

      const newOutput = $(e.target).val();
      step.last_output = newOutput;
      saveSettingsDebounced();

      if (step.variable_name && step.variable_name.trim() !== "") {
        const varName = step.variable_name.trim();
        const stContext = SillyTavern.getContext();
        if (stContext.chatMetadata) {
          if (typeof stContext.chatMetadata.variables !== 'object') {
            stContext.chatMetadata.variables = {};
          }
          stContext.chatMetadata.variables[varName] = newOutput;
          if (typeof stContext.saveMetadata === 'function') {
            await stContext.saveMetadata();
          }
        }
        toastr.success("OUTPUT SAVED");
      }
    });

    // run button
    $(document).off('click', '#wu_force_run').on('click', '#wu_force_run', async () => {
      if (isUpdating) {
        // stop the rchain and try to stop the main story generation
        abortController?.abort();
        try {
          const stContext = SillyTavern.getContext();
          if (typeof stContext.abortController?.abort === 'function') {
            stContext.abortController.abort();
          }
          if (typeof window.stopGeneration === 'function') {
            window.stopGeneration();
          }
          if (typeof window.api?.stopGeneration === 'function') {
            await window.api.stopGeneration();
          }
        } catch (e) {
          console.debug('[World Updater] Could not stop main generation:', e);
        }
        return;
      }
      const result = await handleUpdate();
      if (result === 'success') {
        toastr.success("CHAIN UPDATE FINISHED");
      }
    });


    // expander
    // it starts here (oh but whre is the commends and why everything seems odd?!)
    // CUZ I MOSTLY USE AI, WHAT U GONNA DO? ARREST ME?!
    const editorModalHtml = `
        <div id="wu_fullscreen_editor" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.9); z-index: 1000000; flex-direction: column; align-items: center; justify-content: center; text-align: left !important; padding: 0; margin: 0; border: none;">
            <div style="width: 90%; height: 90%; background: #131518; padding: 20px; border-radius: 8px; display: flex; flex-direction: column; border: 1px solid #444; box-shadow: 0 0 30px #000; text-align: left !important;">

                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; text-align: left !important;">

                    <h3 id="wu_editor_title"
                      style="margin: 0;
                      color: white;
                      font-family:
                      sans-serif;">Fullscreen</h3>

                    <button id="wu_editor_close" class="menu_button" style="color: #ff5555; background: rgba(255,0,0,0.1); border: 1px solid #ff5555; padding: 5px 15px; cursor: pointer;">X</button>
                </div>
                          
                <div id="wu_editor_container_single" style="display: flex; flex: 1; flex-direction: column; background: #000; border: 1px solid #333; overflow: hidden;">
                    <textarea id="wu_editor_textarea" style="width: 100%; height: 100%; font-family: monospace; font-size: 14px; padding: 15px; resize: none; color: #fff; background: transparent; border: none; text-align: left !important;"></textarea>
                </div>

                <div id="wu_editor_container_split" style="display: none; flex: 1; flex-direction: column; gap: 10px; overflow: hidden;">
                    <label style="color:#ffcc00; font-weight:bold; font-size:12px;">IF</label>
                    <div style="height: 30%; background: #000; border: 1px solid #553; border-radius: 4px;">
                        <textarea id="wu_editor_textarea_cond" style="width: 100%; height: 100%; font-family: monospace; font-size: 14px; padding: 10px; resize: none; color: #ffcc00; background: transparent; border: none; text-align: left !important;"></textarea>
                    </div>
                          
                    <div style="display:flex; gap:4px; align-items:center;">
                        <label style="color:#ffcc00; font-weight:bold; font-size:12px;">IS TRUE,</label>
                        <label style="color:#00ffcc; font-weight:bold; font-size:12px;">THEN</label>
                    </div>

                    <div style="flex: 1; background: #000; border: 1px solid #335; border-radius: 4px;">
                        <textarea id="wu_editor_textarea_content" style="width: 100%; height: 100%; font-family: monospace; font-size: 14px; padding: 10px; resize: none; color: #fff; background: transparent; border: none; text-align: left !important;"></textarea>
                    </div>
                </div>

                <div style="margin-top: 15px;">
                    <button id="wu_editor_save" class="menu_button" style="width: 100%; padding: 12px; background: rgba(0,255,204,0.1); border: 1px solid #00ffcc; color: #00ffcc; font-weight: bold; cursor: pointer;">Save</button>
                </div>
            </div>
                         </div>`;

    if ($('#wu_fullscreen_editor').length === 0) {
      $('body').append(editorModalHtml);
    }

    let activeEditorMode = 'single';
    let activeEditorTarget1 = null;
    let activeEditorTarget2 = null;

    $(document).off('click', '.wu_expand_btn').on('click', '.wu_expand_btn', function(e) {
      e.preventDefault();
      e.stopPropagation();

      const targetSelector = $(this).attr('data-target-selector');
      let $target = $(targetSelector);

      if ($target.length) {
        activeEditorMode = 'single';
        activeEditorTarget1 = $target;
        activeEditorTarget2 = null;

        clearDecorators();

        $('#wu_editor_container_split').hide();
        $('#wu_editor_container_single').css('display', 'flex');

        $('#wu_editor_textarea').val($target.val());
        $('#wu_editor_title').text($(this).attr('title') || 'Expanded Editor');
        $('#wu_fullscreen_editor').css('display', 'flex');

        if (targetSelector !== '#wu_last_output') {
          setTimeout(() => {
            wu_editor_decorator = applyJavaHighlighting(document.getElementById('wu_editor_textarea'));
          }, 50);
        } else {
          // FIX: Ensure output box text is visible and colored correctly
          $('#wu_editor_textarea').css({
            'color': '#00ffcc',
            'background': 'transparent'
          });
        }
      }
    });

    $(document).off('click', '.wu_expand_block_btn').on('click', '.wu_expand_block_btn', function(e) {
      e.preventDefault();
      e.stopPropagation();

      const step = $(this).attr('data-step');
      const block = $(this).attr('data-block');
      const $condTarget = $(`.wu_block_run_condition_js[data-step="${step}"][data-block="${block}"]`);
      const $contentTarget = $(`.wu_block_content[data-step="${step}"][data-block="${block}"]`);
      const isConditionVisible = $condTarget.closest('.wu_condition_row').is(':visible');

      clearDecorators();

      if (isConditionVisible) {
        activeEditorMode = 'split';
        activeEditorTarget1 = $condTarget;
        activeEditorTarget2 = $contentTarget;
        $('#wu_editor_container_single').hide();
        $('#wu_editor_container_split').css('display', 'flex');
        $('#wu_editor_textarea_cond').val($condTarget.val());
        $('#wu_editor_textarea_content').val($contentTarget.val());
      } else {
        activeEditorMode = 'single';
        activeEditorTarget1 = $contentTarget;
        activeEditorTarget2 = null;
        $('#wu_editor_container_split').hide();
        $('#wu_editor_container_single').css('display', 'flex');
        $('#wu_editor_textarea').val($contentTarget.val());
      }

      $('#wu_editor_title').text('Fullscreen');
      $('#wu_fullscreen_editor').css('display', 'flex');

      setTimeout(() => {
        if (activeEditorMode === 'split') {
          wu_editor_decorator_cond = applyJavaHighlighting(document.getElementById('wu_editor_textarea_cond'));
          wu_editor_decorator = applyJavaHighlighting(document.getElementById('wu_editor_textarea_content'));
        } else {
          wu_editor_decorator = applyJavaHighlighting(document.getElementById('wu_editor_textarea'));
        }
      }, 50);
    });

    $(document).off('click', '#wu_editor_save').on('click', '#wu_editor_save', function(e) {
      e.preventDefault();
      e.stopPropagation();

      if (activeEditorMode === 'split') {
        if (activeEditorTarget1) {
          activeEditorTarget1.val($('#wu_editor_textarea_cond').val()).trigger('input').trigger('change');
        }
        if (activeEditorTarget2) {
          activeEditorTarget2.val($('#wu_editor_textarea_content').val()).trigger('input').trigger('change');
        }
      } else {
        if (activeEditorTarget1) {
          activeEditorTarget1.val($('#wu_editor_textarea').val()).trigger('input').trigger('change');
        }
      }

      clearDecorators();
      $('#wu_fullscreen_editor').hide();
      activeEditorTarget1 = null;
      activeEditorTarget2 = null;
    });

    $(document).off('click', '#wu_editor_close').on('click', '#wu_editor_close', function(e) {
      e.preventDefault();
      e.stopPropagation();

      clearDecorators();
      $('#wu_fullscreen_editor').hide();
      activeEditorTarget1 = null;
      activeEditorTarget2 = null;
    });

    window.addEventListener('mousedown', function(e) {
      const modal = document.getElementById('wu_fullscreen_editor');
      if (modal && modal.style.display !== 'none' && modal.contains(e.target)) {
        e.stopImmediatePropagation();
      }
    }, true);

    // Also block other events just in case
    $(document).on('mouseup click touchstart', '#wu_fullscreen_editor', function(e) {
      e.stopPropagation();
    });

    //
    // the logic will end here if im not wrong, lol it looks like a penis -)
    //

    // a new refresh button because it was being a pain..
    $(document).off('click', '#wu_refresh_ui').on('click', '#wu_refresh_ui', () => {
      refreshUI();
    });
    /*
    everything went fine, right? =D
    toastr.warning("!DO NOT FORGET TO ENABLE EXPERIMENTAL MACRO ENGINE"); // yeah dont forget silly user
    wu_log("Do not forget to enable experimental macro engine");
    toastr.success("WORLD UPDATER HAS BEEN LOADED");
    */
    // WARNING
    toastr.error("You may face bugs!");
    toastr.warning("This extension (World Updater) is currently in maintance, please avoid using the copy blocks/steps function");
    toastr.error("!!! WARNING !!!");
    wu_log("The world updater apparently works without any issue.");
  }

  eventSource.on(event_types.APP_READY, async () => {
    await loadEditorResources();
    setupUI();
  });

  // before ai
  eventSource.on(event_types.MESSAGE_SENT, async () => {
    const settings = extensionSettings[MODULE_NAME];
    const p = settings.profiles[settings.active_profile];

    if (p.run_mode === 'after_user' || p.run_mode === 'auto') {
      await handleUpdate();
    }
  });

  // after ai
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async () => {
    const settings = extensionSettings[MODULE_NAME];
    const p = settings.profiles[settings.active_profile];

    if (p.run_mode === 'after_ai' || p.run_mode === 'auto') {
      await handleUpdate();
    }
  });
  // update specific character list if switch chats while settings are open
  eventSource.on(event_types.CHAT_CHANGED, () => {
    refreshUI();
    toggleRunButtonVisibility();
  });

  // end
})();