
const availableTools = [
    {
        "type": "function",
        "function": {
            "name": "turn_on_light",
            "description": "Turn on a light in a specified location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity": {
                        "type": "string",
                        "description": "Entity of the light to turn on",
                    },
                    "brightness": {
                        "type": "integer",
                        "description": "Brightness level of the light (0-255)"
                    }
                },
                "required": ["entity"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "turn_off_light",
            "description": "Turn off a light in a specified location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity": {
                        "type": "string",
                        "description": "Entity of the light to turn off",
                    }
                },
                "required": ["entity"],
                "additionalProperties": false
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "turn_on_lights_in_area",
            "description": "Turn on all the lights in a specified area.",
            "parameters": {
                "type": "object",
                "properties": {
                    "area": {
                        "type": "string",
                        "description": "Name of the area whose lights should be turned on (e.g., 'living room')"
                    },
                    "brightness": {
                        "type": "integer",
                        "description": "Brightness level of the lights (0-255)"
                    }
                },
                "required": ["area"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_home_entities",
            "description": "Get a list of entities with their IDs and states from Home Assistant, optionally filtered by domain.",
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {
                        "type": "string",
                        "description": "The domain to filter entities by (e.g., 'light', 'sensor', 'script')."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_script",
            "description": "Trigger a Home Assistant script by name to run.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity": {
                        "type": "string",
                        "description": "The entity of the script to trigger (e.g., 'lights_on')"
                    }
                },
                "required": ["entity"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_scene",
            "description": "Sets a Home Assistant scene by entity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity": {
                        "type": "string",
                        "description": "The entity of the scene to set (e.g., 'scene.movie_night')"
                    }
                },
                "required": ["entity"]
            }
        }
    }
]
    
class ToolHandler {
    constructor(homeAssistantClient, entityStore) {
        this.homeAssistantClient = homeAssistantClient;
        this.entityStore = entityStore;
    }

    /**
     * Refresh one entity's state in the local store
     * after a successful action (safety net in case
     * the state_changed subscription is down).
     */
    async syncEntityState(entityId) {
        try {
            const state = await this.homeAssistantClient.getState(entityId);
            if (this.entityStore) {
                const existing = this.entityStore.get(entityId);
                this.entityStore.handleStateChanged({
                    data: {
                        entity_id: entityId,
                        new_state: state
                    }
                });
            }
        } catch (error) {
            console.error(`Failed to sync state for ${entityId}:`, error.message);
        }
    }

    async handleTool(toolName, toolArgs) {
        switch (toolName) {
            case "turn_on_light":
                return await this.handleTurnOnLight(toolArgs);
            case "turn_off_light":
                return await this.handleTurnOffLight(toolArgs);
            case "turn_on_lights_in_area":
                return await this.handleTurnOnLightsInArea(toolArgs);
            case "get_home_entities":
                return await this.handleGetHomeEntities(toolArgs);
            case "trigger_script":
                return await this.handleTriggerScript(toolArgs);
            case "set_scene":
                return await this.handleSettingScene(toolArgs);
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    async handleGetHomeEntities({ domain }) {
        try {
            const entities = await this.entityStore.getLLMContext({ domains: domain ? [domain] : null });
            return `Here is a JSON object of possible entities to choose from: ${JSON.stringify(entities)}`;
        } catch (error) {
            return `Failed to get entities: ${error.message}`;
        }
    }

    async handleTurnOnLight({ entity, brightness = 100 }) {
        if (!entity) {
            // throw new Error("Entity ID is required to turn on a light.");
            return 'Failed: Light not found.'; // Entity ID is required
        }
        if (!this.entityStore.get(entity)) {
            return 'Failed: not found.'; // Entity not found in the store
        }
        try {
            const result = await this.homeAssistantClient.turnOnLight(entity, { brightness });
            await this.syncEntityState(entity);
            return result ? `Light "${entity}" turned on successfully.` : 'Failed: did not turn on the light.';
        } catch (error) {
            return `Failed: turning on light: ${error.message}`;
        }
    }

    async handleTurnOffLight({ entity }) {
        if (!entity) {
            // throw new Error("Entity ID is required to turn off a light.");
            return 'Failed: Light not found.'; // Entity ID is required
        }
        if (!this.entityStore.get(entity)) {
            return 'Failed: Light not found.'; // Entity not found in the store
        }
        try {
            const result = await this.homeAssistantClient.turnOffLight(entity);
            await this.syncEntityState(entity);
            return result ? `Light "${entity}" turned off successfully.` : 'Failed: did not turn off the light.';
        } catch (error) {
            return `Failed: turning off light: ${error.message}`;
        }
    }

    async handleTurnOnLightsInArea({ area, brightness = 100 }) {
        if (!area) {
            return 'Failed: Area name is required to turn on lights.';
        }
        const lights = this.entityStore.getByAreaAndDomain(area, "light");
        if (lights.length === 0) {
            return `Failed: no lights found in area "${area}".`;
        }
        try {
            const entityIds = lights.map(l => l.entity_id);
            const result = await this.homeAssistantClient.turnOnLights(entityIds, { brightness });
            await Promise.all(entityIds.map(id => this.syncEntityState(id)));
            return `Lights turned on successfully in area "${area}" (${entityIds.length} light${entityIds.length === 1 ? '' : 's'}).`;
        } catch (error) {
            return `Failed: turning on lights in area "${area}": ${error.message}`;
        }
    }

    async handleTriggerScript({ entity }) {
        if (!entity) {
            return 'Failed: Script name is required to trigger a script.';
        }
        try {
            const result = await this.homeAssistantClient.triggerScript(entity);
            return result ? `Script "${entity}" triggered successfully.` : `Failed: did not trigger the script.`;
        } catch (error) {
            return `Failed: triggering script "${entity}": ${error.message}`;
        }
    }

    async handleSettingScene({ entity }) {
        if (!entity) {
            return 'Failed: Scene entity is required to trigger a scene.';
        }
        if (!this.entityStore.get(entity)) {
            return 'Failed: scene not found.'; // Entity not found in the store
        }
        try {
            const result = await this.homeAssistantClient.triggerScene(entity);
            await this.syncEntityState(entity);
            return result ? `Scene "${entity}" triggered successfully.` : `Failed: did not trigger the scene.`;
        } catch (error) {
            return `Failed: triggering scene "${entity}": ${error.message}`;
        }
    }
}

module.exports = {
    availableTools,
    ToolHandler
}