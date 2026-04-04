/**
 * Basic Usage Example for BAML SAP TypeScript
 * 
 * This example demonstrates the core functionality:
 * 1. Creating prompts with schema instructions
 * 2. Parsing LLM responses
 * 3. Handling chain-of-thought reasoning
 */

import Type from 'typebox';
import {
  createPromptWithSchema,
  parseResponse,
  parsePartialResponse,
  hasChainOfThought,
  debugParse,
} from '../src/index.js';

// Define schemas using TypeBox

// Simple schema for user extraction
const UserSchema = Type.Object({
  name: Type.String({ description: 'The user\'s full name' }),
  age: Type.Number({ minimum: 0, maximum: 150 }),
  email: Type.Optional(Type.String({ format: 'email' })),
  isActive: Type.Boolean({ default: true }),
});

// Type alias available for use: type User = Static<typeof UserSchema>;

// Schema for order information
const OrderStatus = Type.Enum({
  ORDERED: 'ORDERED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
});

const OrderSchema = Type.Object({
  orderId: Type.String(),
  status: OrderStatus,
  items: Type.Array(Type.Object({
    name: Type.String(),
    quantity: Type.Integer({ minimum: 1 }),
    price: Type.Number({ minimum: 0 }),
  })),
  total: Type.Number({ minimum: 0 }),
});

// Type alias available for use: type Order = Static<typeof OrderSchema>;

// Schema for union type (classification)
const ClassificationSchema = Type.Union([
  Type.Object({
    category: Type.Literal('animal'),
    species: Type.String(),
    habitat: Type.String(),
  }),
  Type.Object({
    category: Type.Literal('plant'),
    species: Type.String(),
    climate: Type.String(),
  }),
  Type.Object({
    category: Type.Literal('mineral'),
    type: Type.String(),
    hardness: Type.Number(),
  }),
]);

// Type alias available for use: type Classification = Static<typeof ClassificationSchema>;

console.log('='.repeat(60));
console.log('BAML SAP TypeScript - Basic Usage Examples');
console.log('='.repeat(60));
console.log();

// Example 1: Basic prompt creation
console.log('─'.repeat(60));
console.log('Example 1: Creating Prompts with Schema');
console.log('─'.repeat(60));
console.log();

const userPrompt = createPromptWithSchema(
  'Extract user information from: "Alice is 30 years old and can be reached at alice@example.com"',
  UserSchema
);

console.log('Generated Prompt:');
console.log(userPrompt);
console.log();

// Example 2: Parsing simple JSON response
console.log('─'.repeat(60));
console.log('Example 2: Parsing Simple JSON Response');
console.log('─'.repeat(60));
console.log();

const simpleResponse = `{
  "name": "Alice",
  "age": 30,
  "email": "alice@example.com",
  "isActive": true
}`;

console.log('Response:', simpleResponse);
console.log();

const result1 = parseResponse(simpleResponse, UserSchema);
console.log('Parse Result:');
console.log('  Success:', result1.success);
console.log('  Value:', JSON.stringify(result1.value, null, 2));
console.log('  Errors:', result1.errors);
console.log();

// Example 3: Parsing JSON from markdown code block
console.log('─'.repeat(60));
console.log('Example 3: Parsing JSON from Markdown Code Block');
console.log('─'.repeat(60));
console.log();

const markdownResponse = `Here's the user information you requested:

\`\`\`json
{
  "name": "Bob",
  "age": 25,
  "isActive": false
}
\`\`\`

Hope this helps!`;

console.log('Response:', markdownResponse);
console.log();

const result2 = parseResponse(markdownResponse, UserSchema);
console.log('Parse Result:');
console.log('  Success:', result2.success);
console.log('  Value:', JSON.stringify(result2.value, null, 2));
console.log('  From Markdown:', result2.meta.fromMarkdown);
console.log('  Fixes:', result2.meta.fixes);
console.log();

// Example 4: Parsing with chain-of-thought reasoning
console.log('─'.repeat(60));
console.log('Example 4: Parsing with Chain-of-Thought Reasoning');
console.log('─'.repeat(60));
console.log();

const reasoningResponse = `Let me think about this step by step.

First, I need to identify the user information in the text.
The user is named Charlie and they are 28 years old.
They don't have an email mentioned, so I'll skip that field.

Therefore, the output JSON is:

\`\`\`json
{
  "name": "Charlie",
  "age": 28,
  "isActive": true
}
\`\`\``;

console.log('Response:', reasoningResponse);
console.log();
console.log('Has chain-of-thought:', hasChainOfThought(reasoningResponse));
console.log();

const result3 = parseResponse(reasoningResponse, UserSchema);
console.log('Parse Result:');
console.log('  Success:', result3.success);
console.log('  Value:', JSON.stringify(result3.value, null, 2));
console.log('  Chain-of-thought filtered:', result3.meta.chainOfThoughtFiltered);
console.log();

// Example 5: Parsing malformed JSON (with fixes)
console.log('─'.repeat(60));
console.log('Example 5: Parsing Malformed JSON (with auto-fixes)');
console.log('─'.repeat(60));
console.log();

const malformedResponse = `{
  "name": "David",
  "age": 35,
  "isActive": true,
}`; // Trailing comma

console.log('Response (malformed):', malformedResponse);
console.log();

const result4 = parseResponse(malformedResponse, UserSchema);
console.log('Parse Result:');
console.log('  Success:', result4.success);
console.log('  Value:', JSON.stringify(result4.value, null, 2));
console.log('  Fixes applied:', result4.meta.fixes);
console.log();

// Example 6: Parsing union types
console.log('─'.repeat(60));
console.log('Example 6: Parsing Union Types');
console.log('─'.repeat(60));
console.log();

const animalResponse = `{
  "category": "animal",
  "species": "Tiger",
  "habitat": "Tropical forests"
}`;

console.log('Response:', animalResponse);
console.log();

const result5 = parseResponse(animalResponse, ClassificationSchema);
console.log('Parse Result:');
console.log('  Success:', result5.success);
console.log('  Value:', JSON.stringify(result5.value, null, 2));
console.log();

// Example 7: Partial/streaming parsing
console.log('─'.repeat(60));
console.log('Example 7: Partial/Streaming Response Parsing');
console.log('─'.repeat(60));
console.log();

const partialResponses = [
  '{',
  '{\n  "name":',
  '{\n  "name": "Eve",',
  '{\n  "name": "Eve",\n  "age": 22',
  '{\n  "name": "Eve",\n  "age": 22\n}',
];

console.log('Simulating streaming response...');
for (const partial of partialResponses) {
  const result = parsePartialResponse(partial, UserSchema);
  console.log(`  Partial: "${partial.substring(0, 30)}..." -> Success: ${result.success}, IsPartial: ${result.isPartial}`);
}
console.log();

// Example 8: Debug parsing
console.log('─'.repeat(60));
console.log('Example 8: Debug Parsing');
console.log('─'.repeat(60));
console.log();

const debugResponse = `Let me analyze this:

The input mentions a user named Frank who is 45.

\`\`\`json
{
  "name": "Frank",
  "age": 45
}
\`\`\``;

const debug = debugParse(debugResponse, UserSchema);
console.log('Debug Information:');
console.log('  Filtered Text:', debug.filteredText.substring(0, 50) + '...');
console.log('  Extracted Value:', JSON.stringify(debug.extractedValue));
console.log('  Extraction Errors:', debug.extractionErrors);
console.log('  Coercion Success:', debug.coercionResult.success);
console.log('  Coercion Errors:', debug.coercionResult.errors);
console.log('  Coercions Applied:', debug.coercionResult.coercions);
console.log();

// Example 9: Complex nested schema
console.log('─'.repeat(60));
console.log('Example 9: Complex Nested Schema (Order)');
console.log('─'.repeat(60));
console.log();

const orderPrompt = createPromptWithSchema(
  'Extract order information from: Order #12345 contains 2x Widget ($10 each) and 1x Gadget ($25). Total is $45.',
  OrderSchema
);

console.log('Generated Prompt:');
console.log(orderPrompt);
console.log();

const orderResponse = `\`\`\`json
{
  "orderId": "12345",
  "status": "ORDERED",
  "items": [
    { "name": "Widget", "quantity": 2, "price": 10.00 },
    { "name": "Gadget", "quantity": 1, "price": 25.00 }
  ],
  "total": 45.00
}
\`\`\``;

console.log('Response:', orderResponse);
console.log();

const result6 = parseResponse(orderResponse, OrderSchema);
console.log('Parse Result:');
console.log('  Success:', result6.success);
console.log('  Value:', JSON.stringify(result6.value, null, 2));
console.log();

// Example 10: Handling errors
console.log('─'.repeat(60));
console.log('Example 10: Handling Validation Errors');
console.log('─'.repeat(60));
console.log();

const invalidResponse = `{
  "name": "Grace",
  "age": -5,
  "email": "not-an-email"
}`;

console.log('Response:', invalidResponse);
console.log();

const result7 = parseResponse(invalidResponse, UserSchema);
console.log('Parse Result:');
console.log('  Success:', result7.success);
console.log('  Errors:', result7.errors);
console.log();

console.log('='.repeat(60));
console.log('Examples completed!');
console.log('='.repeat(60));
