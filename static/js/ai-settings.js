// AI设置管理

import { apiRequest } from './api.js';

// 全局变量
let currentModels = [];
let currentEndpoints = [];
let currentConfigs = [];

// ========== 模态框控制 ==========

// 打开AI设置
window.openAISettings = async function() {
    document.getElementById('aiSettingsModal').style.display = 'flex';
    // 默认加载AI模型列表
    await loadModels();
};

// 关闭AI设置
window.closeAISettings = function() {
    document.getElementById('aiSettingsModal').style.display = 'none';
};

// 切换设置标签页
window.switchSettingsTab = async function(tabName) {
    // 切换标签按钮状态
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // 切换面板显示
    document.querySelectorAll('.settings-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(`${tabName}Panel`).classList.add('active');

    // 加载对应数据
    if (tabName === 'models') {
        await loadModels();
    } else if (tabName === 'endpoints') {
        await loadEndpoints();
    } else if (tabName === 'configs') {
        await loadConfigs();
    }
};

// ========== AI模型管理 ==========

// 加载AI模型列表
async function loadModels() {
    const container = document.getElementById('modelsList');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
        const data = await apiRequest('/api/ai/models');
        currentModels = data.data || [];

        if (currentModels.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-brain"></i>
                    <h4>暂无AI模型</h4>
                    <p>点击上方按钮添加第一个模型</p>
                </div>
            `;
            return;
        }

        container.innerHTML = currentModels.map(model => `
            <div class="item-card">
                <div class="item-header">
                    <div class="item-title">
                        <h4>${escapeHtml(model.display_name || model.name)}</h4>
                        <div class="item-subtitle">${escapeHtml(model.name)}</div>
                    </div>
                    <div class="item-actions">
                        <button class="btn-icon" onclick="editModel(${model.id})" title="编辑">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="btn-icon btn-danger" onclick="deleteModel(${model.id})" title="删除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="item-body">
                    ${model.provider ? `
                        <div class="item-field">
                            <div class="item-field-label">提供商</div>
                            <div class="item-field-value">${escapeHtml(model.provider)}</div>
                        </div>
                    ` : ''}
                    ${model.description ? `
                        <div class="item-field">
                            <div class="item-field-label">描述</div>
                            <div class="item-field-value">${escapeHtml(model.description)}</div>
                        </div>
                    ` : ''}
                    <div class="item-field">
                        <div class="item-field-label">状态</div>
                        <div class="item-field-value">
                            <span class="item-badge ${model.is_active ? 'badge-active' : 'badge-inactive'}">
                                ${model.is_active ? '✓ 启用' : '✗ 禁用'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
    }
}

// 显示添加模型表单
window.showAddModelForm = function() {
    document.getElementById('modelFormTitle').textContent = '添加AI模型';
    document.getElementById('modelForm').reset();
    document.getElementById('modelId').value = '';
    document.getElementById('modelIsActive').checked = true;
    document.getElementById('modelFormModal').style.display = 'flex';
};

// 编辑模型
window.editModel = function(id) {
    const model = currentModels.find(m => m.id === id);
    if (!model) return;

    document.getElementById('modelFormTitle').textContent = '编辑AI模型';
    document.getElementById('modelId').value = model.id;
    document.getElementById('modelName').value = model.name;
    document.getElementById('modelDisplayName').value = model.display_name || '';
    document.getElementById('modelProvider').value = model.provider || '';
    document.getElementById('modelDescription').value = model.description || '';
    document.getElementById('modelIsActive').checked = model.is_active;
    document.getElementById('modelFormModal').style.display = 'flex';
};

// 关闭模型表单
window.closeModelForm = function() {
    document.getElementById('modelFormModal').style.display = 'none';
};

// 保存模型
window.saveModel = async function() {
    const id = document.getElementById('modelId').value;
    const data = {
        name: document.getElementById('modelName').value,
        display_name: document.getElementById('modelDisplayName').value,
        provider: document.getElementById('modelProvider').value,
        description: document.getElementById('modelDescription').value,
        is_active: document.getElementById('modelIsActive').checked
    };

    try {
        if (id) {
            data.id = parseInt(id);
            await apiRequest('/api/ai/models/update', 'POST', data);
        } else {
            await apiRequest('/api/ai/models/create', 'POST', data);
        }
        closeModelForm();
        await loadModels();
    } catch (error) {
        alert('保存失败: ' + error.message);
    }
};

// 删除模型
window.deleteModel = async function(id) {
    if (!confirm('确定要删除这个模型吗？')) return;

    try {
        await apiRequest(`/api/ai/models/delete?id=${id}`, 'POST');
        await loadModels();
    } catch (error) {
        alert('删除失败: ' + error.message);
    }
};

// ========== API接口管理 ==========

// 加载API接口列表
async function loadEndpoints() {
    const container = document.getElementById('endpointsList');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
        const data = await apiRequest('/api/ai/endpoints');
        currentEndpoints = data.data || [];

        if (currentEndpoints.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-plug"></i>
                    <h4>暂无API接口</h4>
                    <p>点击上方按钮添加第一个接口</p>
                </div>
            `;
            return;
        }

        container.innerHTML = currentEndpoints.map(endpoint => `
            <div class="item-card">
                <div class="item-header">
                    <div class="item-title">
                        <h4>${escapeHtml(endpoint.name)}</h4>
                        <div class="item-subtitle">${escapeHtml(endpoint.base_url)}</div>
                    </div>
                    <div class="item-actions">
                        <button class="btn-icon" onclick="editEndpoint(${endpoint.id})" title="编辑">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="btn-icon btn-danger" onclick="deleteEndpoint(${endpoint.id})" title="删除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="item-body">
                    ${endpoint.provider ? `
                        <div class="item-field">
                            <div class="item-field-label">提供商</div>
                            <div class="item-field-value">${escapeHtml(endpoint.provider)}</div>
                        </div>
                    ` : ''}
                    ${endpoint.description ? `
                        <div class="item-field">
                            <div class="item-field-label">描述</div>
                            <div class="item-field-value">${escapeHtml(endpoint.description)}</div>
                        </div>
                    ` : ''}
                    <div class="item-field">
                        <div class="item-field-label">状态</div>
                        <div class="item-field-value">
                            <span class="item-badge ${endpoint.is_active ? 'badge-active' : 'badge-inactive'}">
                                ${endpoint.is_active ? '✓ 启用' : '✗ 禁用'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
    }
}

// 显示添加接口表单
window.showAddEndpointForm = function() {
    document.getElementById('endpointFormTitle').textContent = '添加API接口';
    document.getElementById('endpointForm').reset();
    document.getElementById('endpointId').value = '';
    document.getElementById('endpointIsActive').checked = true;
    document.getElementById('endpointFormModal').style.display = 'flex';
};

// 编辑接口
window.editEndpoint = function(id) {
    const endpoint = currentEndpoints.find(e => e.id === id);
    if (!endpoint) return;

    document.getElementById('endpointFormTitle').textContent = '编辑API接口';
    document.getElementById('endpointId').value = endpoint.id;
    document.getElementById('endpointName').value = endpoint.name;
    document.getElementById('endpointBaseURL').value = endpoint.base_url;
    document.getElementById('endpointAPIKey').value = endpoint.api_key;
    document.getElementById('endpointProvider').value = endpoint.provider || '';
    document.getElementById('endpointDescription').value = endpoint.description || '';
    document.getElementById('endpointIsActive').checked = endpoint.is_active;
    document.getElementById('endpointFormModal').style.display = 'flex';
};

// 关闭接口表单
window.closeEndpointForm = function() {
    document.getElementById('endpointFormModal').style.display = 'none';
};

// 保存接口
window.saveEndpoint = async function() {
    const id = document.getElementById('endpointId').value;
    const data = {
        name: document.getElementById('endpointName').value,
        base_url: document.getElementById('endpointBaseURL').value,
        api_key: document.getElementById('endpointAPIKey').value,
        provider: document.getElementById('endpointProvider').value,
        description: document.getElementById('endpointDescription').value,
        is_active: document.getElementById('endpointIsActive').checked
    };

    try {
        if (id) {
            data.id = parseInt(id);
            await apiRequest('/api/ai/endpoints/update', 'POST', data);
        } else {
            await apiRequest('/api/ai/endpoints/create', 'POST', data);
        }
        closeEndpointForm();
        await loadEndpoints();
    } catch (error) {
        alert('保存失败: ' + error.message);
    }
};

// 删除接口
window.deleteEndpoint = async function(id) {
    if (!confirm('确定要删除这个接口吗？')) return;

    try {
        await apiRequest(`/api/ai/endpoints/delete?id=${id}`, 'POST');
        await loadEndpoints();
    } catch (error) {
        alert('删除失败: ' + error.message);
    }
};

// ========== 模型配置管理 ==========

// 加载模型配置列表
async function loadConfigs() {
    const container = document.getElementById('configsList');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
        const data = await apiRequest('/api/ai/configs');
        currentConfigs = data.data || [];

        if (currentConfigs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-sliders"></i>
                    <h4>暂无模型配置</h4>
                    <p>点击上方按钮添加第一个配置</p>
                </div>
            `;
            return;
        }

        container.innerHTML = currentConfigs.map(config => `
            <div class="item-card">
                <div class="item-header">
                    <div class="item-title">
                        <h4>${escapeHtml(config.name)}</h4>
                        <div class="item-subtitle">
                            ${config.ai_model ? escapeHtml(config.ai_model.display_name || config.ai_model.name) : '未知模型'}
                            ${config.is_default ? '<span class="item-badge badge-default">默认</span>' : ''}
                        </div>
                    </div>
                    <div class="item-actions">
                        ${!config.is_default ? `
                            <button class="btn-icon btn-success" onclick="setDefaultConfig(${config.id})" title="设为默认">
                                <i class="fa-solid fa-star"></i>
                            </button>
                        ` : ''}
                        <button class="btn-icon" onclick="editConfig(${config.id})" title="编辑">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="btn-icon btn-danger" onclick="deleteConfig(${config.id})" title="删除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="item-body">
                    <div class="item-field">
                        <div class="item-field-label">Temperature</div>
                        <div class="item-field-value">${config.temperature}</div>
                    </div>
                    <div class="item-field">
                        <div class="item-field-label">Max Tokens</div>
                        <div class="item-field-value">${config.max_tokens}</div>
                    </div>
                    <div class="item-field">
                        <div class="item-field-label">Top P</div>
                        <div class="item-field-value">${config.top_p}</div>
                    </div>
                    ${config.system_prompt ? `
                        <div class="item-field" style="grid-column: 1 / -1;">
                            <div class="item-field-label">系统提示词</div>
                            <div class="item-field-value">${escapeHtml(config.system_prompt).substring(0, 100)}...</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
    }
}

// 显示添加配置表单
window.showAddConfigForm = async function() {
    document.getElementById('configFormTitle').textContent = '添加模型配置';
    document.getElementById('configForm').reset();
    document.getElementById('configId').value = '';
    document.getElementById('configIsDefault').checked = false;

    // 加载模型和接口选项
    await loadConfigFormOptions();

    document.getElementById('configFormModal').style.display = 'flex';
};

// 加载配置表单的选项
async function loadConfigFormOptions() {
    try {
        // 强制重新加载模型列表（确保是最新的）
        const modelsData = await apiRequest('/api/ai/models');
        currentModels = modelsData.data || [];

        // 强制重新加载接口列表（确保是最新的）
        const endpointsData = await apiRequest('/api/ai/endpoints');
        currentEndpoints = endpointsData.data || [];

        // 过滤启用的模型
        const activeModels = currentModels.filter(m => m.is_active);
        const activeEndpoints = currentEndpoints.filter(e => e.is_active);

        // 填充模型下拉框
        const modelSelect = document.getElementById('configModelId');
        if (activeModels.length === 0) {
            modelSelect.innerHTML = '<option value="">暂无可用模型，请先添加并启用模型</option>';
        } else {
            modelSelect.innerHTML = '<option value="">请选择模型</option>' +
                activeModels.map(m =>
                    `<option value="${m.ID || m.id}">${escapeHtml(m.display_name || m.name)}</option>`
                ).join('');
        }

        // 填充接口下拉框
        const endpointSelect = document.getElementById('configEndpointId');
        if (activeEndpoints.length === 0) {
            endpointSelect.innerHTML = '<option value="">暂无可用接口，请先添加并启用接口</option>';
        } else {
            endpointSelect.innerHTML = '<option value="">请选择接口</option>' +
                activeEndpoints.map(e =>
                    `<option value="${e.ID || e.id}">${escapeHtml(e.name)}</option>`
                ).join('');
        }

        // 如果没有可用选项，给用户提示
        if (activeModels.length === 0 || activeEndpoints.length === 0) {
            alert('提示：请先在"AI模型"和"API接口"标签页中添加并启用至少一个模型和一个接口。');
        }
    } catch (error) {
        console.error('加载选项失败:', error);
        alert('加载选项失败: ' + error.message);
    }
}

// 编辑配置
window.editConfig = async function(id) {
    const config = currentConfigs.find(c => c.id === id);
    if (!config) return;

    await loadConfigFormOptions();

    document.getElementById('configFormTitle').textContent = '编辑模型配置';
    document.getElementById('configId').value = config.id;
    document.getElementById('configName').value = config.name;
    document.getElementById('configModelId').value = config.model_id;
    document.getElementById('configEndpointId').value = config.endpoint_id;
    document.getElementById('configTemperature').value = config.temperature;
    document.getElementById('configMaxTokens').value = config.max_tokens;
    document.getElementById('configTopP').value = config.top_p;
    document.getElementById('configFrequencyPenalty').value = config.frequency_penalty;
    document.getElementById('configPresencePenalty').value = config.presence_penalty;
    document.getElementById('configSystemPrompt').value = config.system_prompt || '';
    document.getElementById('configIsDefault').checked = config.is_default;
    document.getElementById('configFormModal').style.display = 'flex';
};

// 关闭配置表单
window.closeConfigForm = function() {
    document.getElementById('configFormModal').style.display = 'none';
};

// 保存配置
window.saveConfig = async function() {
    const id = document.getElementById('configId').value;
    const modelIdValue = document.getElementById('configModelId').value;
    const endpointIdValue = document.getElementById('configEndpointId').value;

    // 验证必填字段 - 空字符串或未选择
    if (!modelIdValue || modelIdValue === '') {
        alert('请选择AI模型');
        return;
    }
    if (!endpointIdValue || endpointIdValue === '') {
        alert('请选择API接口');
        return;
    }

    const modelId = parseInt(modelIdValue);
    const endpointId = parseInt(endpointIdValue);

    // 再次验证转换后的值
    if (isNaN(modelId) || modelId <= 0) {
        alert('模型ID无效，请重新选择');
        return;
    }
    if (isNaN(endpointId) || endpointId <= 0) {
        alert('接口ID无效，请重新选择');
        return;
    }

    const data = {
        name: document.getElementById('configName').value,
        model_id: modelId,
        endpoint_id: endpointId,
        temperature: parseFloat(document.getElementById('configTemperature').value),
        max_tokens: parseInt(document.getElementById('configMaxTokens').value),
        top_p: parseFloat(document.getElementById('configTopP').value),
        frequency_penalty: parseFloat(document.getElementById('configFrequencyPenalty').value),
        presence_penalty: parseFloat(document.getElementById('configPresencePenalty').value),
        system_prompt: document.getElementById('configSystemPrompt').value,
        is_default: document.getElementById('configIsDefault').checked
    };

    // 调试日志
    console.log('准备保存配置:', data);

    try {
        let savedId = id;
        if (id) {
            data.id = parseInt(id);
            await apiRequest('/api/ai/configs/update', 'POST', data);
        } else {
            const result = await apiRequest('/api/ai/configs/create', 'POST', data);
            savedId = result.data?.id;
        }

        // 如果设置为默认，需要调用设置默认接口
        if (data.is_default && savedId) {
            await apiRequest(`/api/ai/configs/set-default?id=${savedId}`, 'POST');
        }

        closeConfigForm();
        await loadConfigs();
    } catch (error) {
        alert('保存失败: ' + error.message);
    }
};

// 设置默认配置
window.setDefaultConfig = async function(id) {
    try {
        await apiRequest(`/api/ai/configs/set-default?id=${id}`, 'POST');
        await loadConfigs();
    } catch (error) {
        alert('设置失败: ' + error.message);
    }
};

// 删除配置
window.deleteConfig = async function(id) {
    if (!confirm('确定要删除这个配置吗？')) return;

    try {
        await apiRequest(`/api/ai/configs/delete?id=${id}`, 'POST');
        await loadConfigs();
    } catch (error) {
        alert('删除失败: ' + error.message);
    }
};

// ========== 工具函数 ==========

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 导出加载函数供外部使用
export { loadModels, loadEndpoints, loadConfigs };
