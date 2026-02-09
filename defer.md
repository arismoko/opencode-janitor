Architectural Recommendations (Include vs Defer)

- AgentRuntimeRegistry: Defer full version. For 2 agents, full registry + delivery pipeline is too much. Use a small internal runtime spec (80% benefit, low cost).
- Decompose RuntimeContext: Defer. It’s large, but splitting now adds churn across all hooks. Revisit only if a third agent or new subsystems land.
- Session ownership dispatcher: Defer. O(1) routing is unnecessary with 2 queues; current double-dispatch is simple and reliable.
