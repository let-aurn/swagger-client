My goal is :
From JSON swaggers, I want to create a library, hosted in my https://github.com/let-aurn account.
Library name "Swagger Client" (@let-aurn/swagger-client).
The lib should contain a client for React (using `fetch()`), and a client for angular (using `HttpClient`).

Say I have the following project.

```java
@RestController
@RequestMapping("/posts")
public class PostsController {

    // GET /posts?page=0&size=20
    @GetMapping
    public List<PostResponse> getPosts(@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return List.of();
    }

    // GET /posts/search?keyword=spring&published=true
    @GetMapping("/search")
    public List<PostResponse> searchPosts(@RequestParam String keyword, @RequestParam(defaultValue = "true") boolean published) {
        return List.of();
    }

    // GET /posts/42
    @GetMapping("/{id}")
    public PostResponse getPost(@PathVariable Long id) {
        return new PostResponse(id, "Spring Boot Guide", "Lorem ipsum...");
    }

    // POST /posts
    @PostMapping
    public PostResponse createPost(@RequestBody CreatePostRequest request) {
        return new PostResponse(1L, request.title(), request.content());
    }

    // PUT /posts/42
    @PutMapping("/{id}")
    public PostResponse updatePost(@PathVariable Long id, @RequestBody UpdatePostRequest request) {
        return new PostResponse(id, request.title(), request.content());
    }

    // DELETE /posts/42
    @DeleteMapping("/{id}")
    public void deletePost(@PathVariable Long id) {
        // Delete the post
    }
}
```

```java
public record CreatePostRequest(String title, String content) { }
public record UpdatePostRequest(String title, String content) { }
public record PostResponse(Long id, String title, String content) { }
```

---

## Endpoints

| Method | Endpoint                                      | Description                                 |
|--------|-----------------------------------------------|---------------------------------------------|
| GET    | `/posts?page=0&size=20`                       | Retrieve a paginated list of posts.         |
| GET    | `/posts/search?keyword=spring&published=true` | Search posts using query parameters.        |
| GET    | `/posts/{id}`                                 | Retrieve a single post by its ID.           |
| POST   | `/posts`                                      | Create a new post from a JSON request body. |
| PUT    | `/posts/{id}`                                 | Update an existing post.                    |
| DELETE | `/posts/{id}`                                 | Delete a post. Returns no content.          |

---

Usage with Angular:
```ts
swaggerClientService = inject(SwaggerClientService);

this.swaggerClientService
  .request(ApiEndpoints.ApiEndpoints.PostsController_getPosts, { queryVariables: { page: 0, size: 20 } })
  .subscribe(response => { /* 'response' should be type of `PostResponse[]` */ });
this.swaggerClientService
  .request(ApiEndpoints.ApiEndpoints.PostsController_searchPosts, { queryVariables: { keyword: 'spring', published: true }})
  .subscribe(response => { /* 'response' should be type of `PostResponse[]` */ });
this.swaggerClientService
  .request(ApiEndpoints.ApiEndpoints.PostsController_getPost, { pathVariable: { id: 123 } })
  .subscribe(response => { /* 'response' should be type of `PostResponse` */ });
this.swaggerClientService
  .request(ApiEndpoints.ApiEndpoints.PostsController_createPost, { bodyVariables: { title: 'some title', content: 'some content' } })
  .subscribe(response => { /* 'response' should be type of `PostResponse` */ });
this.swaggerClientService
  .request(ApiEndpoints.ApiEndpoints.PostsController_updatePost, { pathVariable: { id: 123 }, bodyVariables: { title: 'some new title', content: 'some new content' } })
  .subscribe(response => { /* 'response' should be type of `PostResponse` */ });
this.swaggerClientService.request(ApiEndpoints.ApiEndpoints.PostsController_deletePost)
  .request(ApiEndpoints.ApiEndpoints.PostsController_getPost, { pathVariable: { id: 123 } })
  .subscribe(response => { /* 'response' should be type of `void` */ });
```

Usage with React:
```ts
// Same as Angular, but the react way
const client = useSwaggerClient(ApiEndpoints.ApiEndpoints.PostsController_getPost);

const response /* type of 'response' should be detected as PostResponse */ = await client.request({
  queryVariables: x, // optional `queryVariables`
  pathVariable: x, // optional `pathVariable`
  bodyVariables: x, // optional `bodyVariables`
});
```

`PostResponse` should be from `api-models.ts`.
`ApiEndpoints.ApiEndpoints.PostsController_createPost` should come from `api-endpoints.ts`.
`queryVariables`, `pathVariable` and `bodyVariables` should be auto-completable by IDE.

How to use the library:
```sh
npx swagger-client generate --config=swagger-client.json
npx swagger-client generate # Using "--config=swagger-client.json" by default
```

Content of `swagger-client.json`, provided by the user
```json
{
  "client": "angular", // or "react"
  "swaggers-directory": "path/to/swaggers-directory",
  "output": {
    "api-models.ts": "path/to/api-models.ts",
    "api-endpoints.ts": "path/to/api-endpoints.ts",
    "client.ts": "path/to/client.ts" // containing definition "this.swaggerClientService.request()" or "swaggerClient.request()"
  }
}
```

"swaggers-directory" should contain:
- swagger1.json
- swagger2.json
- swagger3.json
- 
