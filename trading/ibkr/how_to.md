# Guide to Creating `AI_strategy.py` from `client_example.py`

This guide outlines adapting the multi-agent sentiment client into an Interactive Brokers stock trading framework.

## Steps
1. Provide the CLI with both `client_example.py` and the existing `strategy.py`.
2. Instruct it to:
   - Copy agent classes and prompt helpers into `AI_strategy.py`.
   - Move main logic into `get_signal(app)`.
   - Pull symbol/exchange from the `app` object.
   - Translate recommendation to `(signal, leverage)` where BUY=1, others=0, and confidence becomes leverage.
   - Keep existing stop-loss / take-profit helpers.
3. Save as `user_config/AI_strategy.py`.

Full source and original instructions are in the uploaded attachments.
