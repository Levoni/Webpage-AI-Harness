
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
                        "description": "Entity ID of the light to turn on",
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
                        "description": "Entity ID of the light to turn off",
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
            "name": "get_home_entities_context",
            "description": "Get a list of entities from Home Assistant, optionally filtered by domain.",
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {
                        "type": "string",
                        "description": "The domain to filter entities by (e.g., 'light', 'sensor')."
                    }
                },
                "required": []
            }
        }
    }
]
    
class ToolHandler {
    constructor(homeAssistantClient, entityStore) {
        this.homeAssistantClient = homeAssistantClient;
        this.entityStore = entityStore;
    }

    async handleTool(toolName, toolArgs) {
        switch (toolName) {
            case "turn_on_light":
                return await this.handleTurnOnLight(toolArgs);
            case "turn_off_light":
                return await this.handleTurnOffLight(toolArgs);
            case "turn_on_lights_in_area":
                return await this.handleTurnOnLightsInArea(toolArgs);
            case "get_home_entities_context":
                return await this.handleGetHomeEntities(toolArgs);
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
            return result ? 'Light turned on successfully.' : 'Failed: did not turn on the light.';
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
            return result ? 'Light turned off successfully.' : 'Failed: did not turn off the light.';
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
            return `Lights turned on successfully in area "${area}" (${entityIds.length} light${entityIds.length === 1 ? '' : 's'}).`;
        } catch (error) {
            return `Failed: turning on lights in area "${area}": ${error.message}`;
        }
    }
}

module.exports = {
    availableTools,
    ToolHandler
}