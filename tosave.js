function formatStepForExport(s, i, isSingle, extensionSettings, MODULE_NAME) {
    const set = extensionSettings[MODULE_NAME];
    const p = set.profiles[set.active_profile];
    const tabIdx = set.active_tab_index ?? 0;
    const tabName = p.tabs?.[tabIdx]?.name || `Tab ${tabIdx + 1}`;
    
    const n = s.name || `Step ${i + 1}`;
    const cap = x => x ? x[0].toUpperCase() + x.slice(1) : '';

    const wrapCode = (code = "", lang = 'text') => {
        const fence = code.includes('```') ? '~~~~' : '```';
        return `${fence}${lang}\n${code}\n${fence}`;
    };

    const hf = p.history_format === 'custom' 
      ? `custom:\n${p.custom_history_format || '{{name}}: {{message}}'}` 
      : (p.history_format || 'json');

    const out = [];

    // header and configuration
    if (!isSingle && i > 0) out.push("\n---");
    
    out.push(
        `# STEP: ${n}\n`,
        `### Configuration`,
        `- **Enabled**: \`${s.enabled !== false ? 'Yes' : 'No'}\``,
        `- **Step Order**: \`${s.order ?? 128}\``,
        `- **History depth**: \`${s.history_depth ?? 1}\``,
        `- **History format**: ${hf.includes('\n') ? `\n${wrapCode(hf)}` : `\`${hf}\``}`,
        `- **Automation trigger**: \`${p.run_mode || 'after_ai'}\``,
        `- **Tab Name**: \`${tabName}\``,
        `- **Tab Pos.**: \`${tabIdx + 1}\``
    );

    if (s.pre_filter_enabled && s.pre_filter_script) {
        out.push(`\n### Pre-filter Script (JS)\n${wrapCode(s.pre_filter_script, 'javascript')}`);
    }

    // blocks
    (s.blocks || []).forEach((b, j) => {
        const lang = b.isCode ? 'javascript' : 'text';
        const roleDisplay = (b.role === 'custom' && b.custom_role_name) 
            ? `Custom (${b.custom_role_name})` 
            : cap(b.role || 'system');

        out.push(
            `\n## Block ${j + 1}${b.isCode ? ' (JS)' : ''}\n`,
            `- **ID**: \`${b.id || 'None'}\``,
            `- **Role**: \`${roleDisplay}\``,
            `- **Order**: \`${b.order ?? 128}\``
        );

        if (b.history_filter === 'condition') {
            out.push(
                `- **Trigger Condition (JS)**:\n${wrapCode(b.run_condition_js, 'javascript')}`,
                `**Content**:\n${wrapCode(b.content, lang)}`
            );
        } else {
            const tr = b.history_filter || 'all';
            const tmap = { all: 'All', user: 'User', char: 'Char' };
            const tN = tr === 'name' ? b.history_filter_name : (tmap[tr] || tr);
            
            out.push(`- **Trigger**: \`${tN}\``);
            if (b.history_exclude?.trim()) {
                out.push(`- **Except (Speakers)**: \`${b.history_exclude}\``);
            }
            out.push(`\n**Content**:\n${wrapCode(b.content, lang)}`);
        }
    });

    // outputs and filters
    if (s.filter_enabled && s.filter_script) {
        out.push(`\n## Output Filter (JS)\n${wrapCode(s.filter_script, 'javascript')}`);
    }

    out.push(`\n## Last Known Output\n${wrapCode(s.last_output || "No output for this step yet.")}`);

    if (s.expected_enabled && s.expected_script) {
        out.push(`\n## Expectation Script (JS)\n${wrapCode(s.expected_script, 'javascript')}`);
    }

    if (s.correction_enabled) {
        out.push(
            `\n## Correction Message`,
            `- **Role**: \`${cap(s.correction_role || 'user')}\` | **Order**: \`${s.correction_order ?? 1}\` | **Max Retries**: \`${s.max_attempts ?? 3}\``,
            `**Correction Content**:\n${wrapCode(s.correction_content)}`
        );
    }

    // save
    if (s.advanced_save_enabled && s.advanced_save_script) {
        out.push(`\n## Post-Execution Script (JS)\n${wrapCode(s.advanced_save_script, 'javascript')}`);
    } else if (s.variable_name) {
        out.push(`\n**Save Result To Variable**: \`{{${s.variable_name}}}\``);
    }
    return out.join('\n') + '\n';
}