// AI设置管理
import { showToast } from './toast.js'; - 重构版

import { apiRequest } from './api.js';

// 全局变量
let currentProviders = [];
let currentTab = 'providers'; // 'providers' 或 'config'

// ========== 打开/关闭设置面板 ==========

window.openAISettings = function() {
    const panel = document.getElementById('aiSettingsPanel');
    if (panel) {
        panel.style.display = 'flex';
        // 加载供应商列表
        loadProviders();
    }
};

window.closeAISettings = function() {
    const panel = document.getElementById('aiSettingsPanel');
    if (panel) {
        panel.style.display = 'none';
    }
};

window.switchSettingsTab = function(tab) {
    currentTab = tab;
    
    // 更新Tab按钮状态
    document.querySelectorAll('.settings-panel-tabs .settings-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.settings-panel-tabs [onclick="switchSettingsTab('${tab}')"]`).classList.add('active');
    
    // 显示对应内容
    if (tab === 'providers') {
        document.getElementById('providersTab').style.display = 'block';
        document.getElementById('configTab').style.display = 'none';
        loadProviders();
    } else if (tab === 'config') {
        document.getElementById('providersTab').style.display = 'none';
        document.getElementById('configTab').style.display = 'block';
        loadGlobalConfig();
    }
};

// ========== 供应商管理 ==========

async function loadProviders() {
    const container = document.getElementById('providersList');
    container.innerHTML = '<div class="loading">加载中...</div>';

    try {
        const data = await apiRequest('/api/ai/providers');
        currentProviders = data.data || [];

        if (currentProviders.length === 0) {
            container.innerHTML = '<div class="empty">暂无供应商，点击右上角添加</div>';
            return;
        }

        container.innerHTML = currentProviders.map(provider => `
            <div class="provider-card">
                <div class="provider-header">
                    <h3>${escapeHtml(provider.name)}</h3>
                    <div class="provider-actions">
                        <button onclick="editProvider('${provider.id}')" title="编辑">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button onclick="deleteProvider('${provider.id}')" title="删除">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="provider-info">
                    <div><strong>ID:</strong> ${escapeHtml(provider.id)}</div>
                    <div><strong>Base URL:</strong> ${escapeHtml(provider.base_url)}</div>
                    <div><strong>API Key:</strong> ${maskApiKey(provider.api_key)}</div>
                </div>
                <div class="provider-models">
                    <strong>模型列表 (${provider.models?.length || 0}):</strong>
                    ${(provider.models || []).map(model => `
                        <span class="model-tag">${escapeHtml(model.name)}</span>
                    `).join('')}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('加载供应商失败:', error);
        container.innerHTML = '<div class="error">加载失败</div>';
    }
}

// 打开供应商表单
window.openProviderForm = function(providerId = null) {
    const form = document.getElementById('providerForm');
    
    form.dataset.providerId = providerId || '';
    
    if (providerId) {
        // 编辑模式
        const provider = currentProviders.find(p => p.id === providerId);
        if (!provider) return;
        
        document.getElementById('providerFormTitle').textContent = '编辑供应商';
        document.getElementById('providerId').value = provider.id;
        document.getElementById('providerName').value = provider.name;
        document.getElementById('providerBaseUrl').value = provider.base_url;
        document.getElementById('providerApiKey').value = provider.api_key;
        
        // 填充模型列表
        const modelsContainer = document.getElementById('providerModels');
        modelsContainer.innerHTML = '';
        (provider.models || []).forEach(model => {
            addModelRow(model.id, model.name);
        });
    } else {
        // 新建模式
        document.getElementById('providerFormTitle').textContent = '添加供应商';
        form.reset();
        document.getElementById('providerModels').innerHTML = '';
        addModelRow(); // 添加一个空行
    }
    
    // 切换视图：隐藏列表，显示表单
    document.getElementById('providersListView').style.display = 'none';
    document.getElementById('providerFormView').style.display = 'block';
};

// 取消供应商表单（返回列表）
window.cancelProviderForm = function() {
    document.getElementById('providersListView').style.display = 'block';
    document.getElementById('providerFormView').style.display = 'none';
};

// 兼容旧代码
window.closeProviderForm = window.cancelProviderForm;

// 添加模型输入行
window.addModelRow = function(modelId = '', modelName = '') {
    const container = document.getElementById('providerModels');
    const row = document.createElement('div');
    row.className = 'model-row';
    row.innerHTML = `
        <input type="text" class="model-id" placeholder="模型ID (如: gpt-4)" value="${escapeHtml(modelId)}">
        <input type="text" class="model-name" placeholder="显示名称 (如: GPT-4)" value="${escapeHtml(modelName)}">
        <button type="button" onclick="this.parentElement.remove()" class="remove-model-btn">
            <i class="fa-solid fa-times"></i>
        </button>
    `;
    container.appendChild(row);
};

// 保存供应商
window.saveProvider = async function(event) {
    event.preventDefault();
    
    const providerId = document.getElementById('providerId').value.trim();
    const providerName = document.getElementById('providerName').value.trim();
    const baseUrl = document.getElementById('providerBaseUrl').value.trim();
    const apiKey = document.getElementById('providerApiKey').value.trim();
    
    if (!providerId || !providerName || !baseUrl || !apiKey) {
        showToast('请填写所有必填字段', 'warning');
        return;
    }
    
    // 收集模型列表
    const modelRows = document.querySelectorAll('#providerModels .model-row');
    const models = [];
    modelRows.forEach(row => {
        const id = row.querySelector('.model-id').value.trim();
        const name = row.querySelector('.model-name').value.trim();
        if (id && name) {
            models.push({ id, name });
        }
    });
    
    if (models.length === 0) {
        showToast('请至少添加一个模型', 'warning');
        return;
    }
    
    const data = {
        id: providerId,
        name: providerName,
        base_url: baseUrl,
        api_key: apiKey,
        models: models
    };
    
    try {
        const isEdit = document.getElementById('providerForm').dataset.providerId;
        
        if (isEdit) {
            await apiRequest('/api/ai/provider/update', 'POST', data);
        } else {
            await apiRequest('/api/ai/provider/create', 'POST', data);
        }
        
        // 保存成功，返回列表
        cancelProviderForm();
        await loadProviders();
        showToast('保存成功', 'success');
        
        // 刷新AI聊天页面的模型缓存
        if (window.refreshModelCache) {
            window.refreshModelCache();
        }
    } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
    }
};

// 编辑供应商
window.editProvider = function(providerId) {
    openProviderForm(providerId);
};

// 删除供应商
window.deleteProvider = async function(providerId) {
    if (!confirm('确定要删除这个供应商吗？')) return;
    
    try {
        await apiRequest(`/api/ai/provider/delete?id=${providerId}`, 'POST');
        await loadProviders();
        
        // 刷新AI聊天页面的模型缓存
        if (window.refreshModelCache) {
            window.refreshModelCache();
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
};

// ========== 全局AI配置 ==========

async function loadGlobalConfig() {
    const container = document.getElementById('configForm');
    
    try {
        const data = await apiRequest('/api/ai/config');
        const config = data.data;
        
        document.getElementById('systemPrompt').value = config.system_prompt || '';
        document.getElementById('temperature').value = config.temperature || 0.7;
        document.getElementById('maxTokens').value = config.max_tokens || 4096;
        document.getElementById('topP').value = config.top_p || 1.0;
        document.getElementById('frequencyPenalty').value = config.frequency_penalty || 0;
        document.getElementById('presencePenalty').value = config.presence_penalty || 0;
        
        // 显示当前值
        updateRangeDisplay();
    } catch (error) {
        console.error('加载配置失败:', error);
        showToast('加载配置失败: ' + error.message, 'error');
    }
}

// 保存全局配置
window.saveGlobalConfig = async function(event) {
    event.preventDefault();
    
    const config = {
        system_prompt: document.getElementById('systemPrompt').value,
        temperature: parseFloat(document.getElementById('temperature').value),
        max_tokens: parseInt(document.getElementById('maxTokens').value),
        top_p: parseFloat(document.getElementById('topP').value),
        frequency_penalty: parseFloat(document.getElementById('frequencyPenalty').value),
        presence_penalty: parseFloat(document.getElementById('presencePenalty').value)
    };
    
    try {
        await apiRequest('/api/ai/config/update', 'POST', config);
        showToast('配置已保存', 'success');
    } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
    }
};

// 更新范围滑块显示值
window.updateRangeDisplay = function() {
    document.getElementById('tempValue').textContent = document.getElementById('temperature').value;
    document.getElementById('topPValue').textContent = document.getElementById('topP').value;
    document.getElementById('freqValue').textContent = document.getElementById('frequencyPenalty').value;
    document.getElementById('presValue').textContent = document.getElementById('presencePenalty').value;
};

// ========== 工具函数 ==========

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function maskApiKey(key) {
    if (!key || key.length < 8) return '***';
    return key.substring(0, 8) + '...' + key.substring(key.length - 4);
}

// 无需初始化，面板打开时自动加载
